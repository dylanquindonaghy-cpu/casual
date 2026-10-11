import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { LIMITS, throttle } from "../auth/throttle";
import { resolveApiKey, type ResolveApiKey } from "../db/directory";
import { withFirm, type WithFirm } from "../db/scoped";
import { appDatabaseIsLocal } from "../db/where";
import { appEnv } from "../env";
import { log, type Logger } from "../log";
import { clientIpFrom, requestIdFrom } from "../request";
import { parseHost } from "../tenancy/host";
import type { Geocoder } from "../travel/geocoder";
import { API_ERRORS, type ApiErrorCode } from "./errors";
import { apiKeyHash, bearerKey, looksLikeApiKey } from "./keys";
import { refusedKeys as processRefusedKeys, type RefusedKeyCounter } from "./refused-keys";

// Every planner API call (docs/office-v2.md 5.3.2; ADR-022) goes through handleApiRequest(), in
// this order, and a refusal answers at once:
//   1. the platform address only (`APP_BASE_DOMAIN`, as Twilio's webhooks): a firm's subdomain or
//      its own domain gets 404 not_found, so the host never chooses a firm;
//   2. INTEGRATIONS_SECRET unset: 503 not_configured;
//   3. an address with REFUSED_KEYS_PER_MINUTE refused keys this minute: 429, before any look-up;
//   4. `Authorization: Bearer <key>` of the key's shape (`shiftdesk_` and 43 base64url characters),
//      else 401 invalid_key without touching the database (and the address's count goes up);
//   5. the look-up (resolveApiKey(): the firm and key id of a live key, by its sha256): none is the
//      same 401 for a wrong key and a revoked one;
//   6. 300 calls a minute per key (throttle(), inside the key's firm): 429 with Retry-After;
//   7. last_used_at, at most once a minute, in a short transaction of its own that never waits
//      (a key's row may be held by a change under way: firm-caller.ts);
//   8. a body (PUT): JSON only (415 not_json), at most 64 KB (413 too_big, by its declared length
//      before reading, then by what arrived), valid UTF-8 JSON (400 bad_json);
//   9. the call's own handler, which runs its work inside withFirm(firmId).
// Server to server: no cookie is read and no CORS header is sent. Each request writes one log line
// (route, method, status, milliseconds, firm id, keyId): never a key, a body or the Authorization
// header. An error's body is {"error": {"code", "message", "request_id"}} with fixed words: no
// value sent in is ever echoed back.

export const MAX_BODY_BYTES = 64 * 1024;
const MINUTE_MS = 60_000;

export interface ApiEnv {
  INTEGRATIONS_SECRET?: string;
  APP_BASE_DOMAIN: string;
  SESSION_SECRET: string;
}

export interface ApiDeps {
  run?: WithFirm;
  resolveKey?: ResolveApiKey;
  now?: () => Date;
  env?: ApiEnv;
  geocoder?: Geocoder; // postcodes the API fills (serverGeocoder() when left out)
  logger?: Logger;
  refusedKeys?: RefusedKeyCounter; // a test's own counter, or reset() the process's one
  localDatabase?: boolean; // Gate B (appDatabaseIsLocal() when left out)
  lastUsed?: LastUsedMemo;
}

export interface ApiCall {
  firmId: string;
  keyId: string;
  requestId: string;
  now: Date;
  json?: unknown; // the parsed body, for a call with one
  url: URL;
  run: WithFirm;
  geocoder?: Geocoder;
  localDatabase: boolean;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ApiResult {
  return { status, body: { error: { code, message, ...extra } } };
}

// One of the listed refusals (src/lib/integrations/errors.ts), with its status and words.
export function apiRefusal(
  code: ApiErrorCode,
  extra: Record<string, unknown> = {},
  headers?: Record<string, string>,
): ApiResult {
  const { status, message } = API_ERRORS[code];
  return { ...apiError(status, code, message, extra), ...(headers ? { headers } : {}) };
}

const isErrorBody = (body: unknown): body is { error: Record<string, unknown> } =>
  typeof body === "object" &&
  body !== null &&
  "error" in body &&
  typeof body.error === "object" &&
  body.error !== null;

function respond(result: ApiResult, requestId: string): Response {
  let body = result.body;
  if (isErrorBody(body)) {
    const { code, message, ...extra } = body.error;
    body = { error: { code, message, request_id: requestId, ...extra } };
  }
  return Response.json(body, {
    status: result.status,
    headers: { "cache-control": "no-store", "x-request-id": requestId, ...result.headers },
  });
}

// When each key's last_used_at was last written by this process: a key used 300 times a minute
// costs one write a minute. Per process; the database's own condition keeps it to once a minute
// across processes.
export type LastUsedMemo = Map<string, number>;
const processLastUsed: LastUsedMemo = new Map();

async function stampLastUsed(
  run: WithFirm,
  firmId: string,
  keyId: string,
  now: Date,
  memo: LastUsedMemo,
): Promise<void> {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  if (memo.get(keyId) === minute) return;
  if (memo.size > 10_000) memo.clear();
  memo.set(keyId, minute);
  // "skip locked": a change under way holds the key's row (src/lib/roster/firm-caller.ts), and the
  // stamp can wait for the next call rather than this call wait for it.
  await run(firmId, (tx) =>
    tx.execute(sql`
      update api_keys set last_used_at = ${now}
       where id = (select k.id from api_keys k
                    where k.id = ${keyId}
                      and (k.last_used_at is null
                           or k.last_used_at <= ${now}::timestamptz - interval '1 minute')
                      for no key update skip locked)
    `),
  );
}

// `application/json`, with or without parameters (a charset).
const isJson = (type: string | null) =>
  type !== null && /^application\/json\s*(?:;|$)/i.test(type.trim());

type Body = { json: unknown } | { refusal: ApiErrorCode };

// The body, read up to MAX_BODY_BYTES and no further (a missing or wrong content-length can't get
// round it), as strict UTF-8 JSON.
async function readJson(request: Request): Promise<Body> {
  if (!isJson(request.headers.get("content-type"))) return { refusal: "not_json" };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return { refusal: "too_big" };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { refusal: "too_big" };
      }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return { json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)) as unknown };
  } catch {
    return { refusal: "bad_json" };
  }
}

const apiEnv = (): ApiEnv => {
  const env = appEnv();
  return {
    INTEGRATIONS_SECRET: env.INTEGRATIONS_SECRET,
    APP_BASE_DOMAIN: env.APP_BASE_DOMAIN,
    SESSION_SECRET: env.SESSION_SECRET,
  };
};

// The id src/proxy.ts gave this request (a fresh one when there's none, outside Next).
const requestIdOf = (request: Request) => {
  const id = requestIdFrom(request.headers);
  return id === "unknown" ? randomUUID() : id;
};

const hostOf = (request: Request) => request.headers.get("host") ?? new URL(request.url).host;

export async function handleApiRequest(
  request: Request,
  opts: {
    route: string; // the route's pattern ("/api/v1/sessions/{ref}"), never the path itself
    method: string;
    body: boolean;
    handler: (call: ApiCall) => Promise<ApiResult>;
  },
  deps: ApiDeps = {},
): Promise<Response> {
  const started = performance.now();
  const requestId = requestIdOf(request);
  const logger = deps.logger ?? log;
  const who: { firmId?: string; keyId?: string } = {};
  const finish = (result: ApiResult, error?: unknown): Response => {
    const fields = {
      requestId,
      route: opts.route,
      method: opts.method,
      status: result.status,
      ms: Math.round(performance.now() - started),
      ...who,
    };
    if (error === undefined) logger.info("api request", fields);
    else logger.error("api request failed", { ...fields, error });
    return respond(result, requestId);
  };
  try {
    const env = deps.env ?? apiEnv();
    if (parseHost(hostOf(request), env.APP_BASE_DOMAIN)?.kind !== "apex") {
      return finish(apiRefusal("not_found"));
    }
    if (!env.INTEGRATIONS_SECRET) return finish(apiRefusal("not_configured"));
    const now = (deps.now ?? (() => new Date()))();
    const counter = deps.refusedKeys ?? processRefusedKeys;
    const address = clientIpFrom(request.headers);
    const waiting = counter.blocked(address, now.getTime());
    if (waiting) {
      return finish(
        apiRefusal("rate_limited", {}, { "retry-after": String(waiting.retryAfterSeconds) }),
      );
    }
    const key = bearerKey(request.headers.get("authorization"));
    const entry =
      key && looksLikeApiKey(key)
        ? await (deps.resolveKey ?? resolveApiKey)(apiKeyHash(key))
        : null;
    if (!entry) {
      counter.note(address, now.getTime());
      return finish(apiRefusal("invalid_key"));
    }
    who.firmId = entry.firmId;
    who.keyId = entry.keyId;
    const run = deps.run ?? withFirm;
    const limited = await throttle(
      run,
      entry.firmId,
      [{ limit: LIMITS.apiPerKey, value: entry.keyId }],
      { now, secret: env.SESSION_SECRET, entityType: "api_key" },
    );
    if (limited) {
      return finish(
        apiRefusal("rate_limited", {}, { "retry-after": String(limited.retryAfterSeconds) }),
      );
    }
    await stampLastUsed(run, entry.firmId, entry.keyId, now, deps.lastUsed ?? processLastUsed);
    let json: unknown;
    if (opts.body) {
      const body = await readJson(request);
      if ("refusal" in body) return finish(apiRefusal(body.refusal));
      json = body.json;
    }
    const result = await opts.handler({
      firmId: entry.firmId,
      keyId: entry.keyId,
      requestId,
      now,
      ...(opts.body ? { json } : {}),
      url: new URL(request.url),
      run,
      ...(deps.geocoder ? { geocoder: deps.geocoder } : {}),
      localDatabase: deps.localDatabase ?? appDatabaseIsLocal(),
    });
    return finish(result);
  } catch (error) {
    return finish(apiRefusal("internal_error"), error);
  }
}

// Any other /api/v1 path or method: a JSON 404, with no look-up (src/app/api/v1/[[...path]]).
export function apiNotFound(
  request: Request,
  method: string,
  deps: Pick<ApiDeps, "logger"> = {},
): Response {
  const requestId = requestIdOf(request);
  (deps.logger ?? log).info("api request", {
    requestId,
    route: "/api/v1/*",
    method,
    status: 404,
    ms: 0,
  });
  return respond(apiRefusal("not_found"), requestId);
}
