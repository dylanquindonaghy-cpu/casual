import type { Pool } from "pg";
import type { ResolveApiKey } from "@/lib/db/directory";
import type { WithFirm } from "@/lib/db/scoped";
import type { ApiDeps } from "@/lib/integrations/api";
import { apiKeyHash, apiKeyHint, newApiKey } from "@/lib/integrations/keys";
import { createRefusedKeyCounter } from "@/lib/integrations/refused-keys";
import type { Logger } from "@/lib/log";
import { fakeGeocoder, type Geocoder } from "@/lib/travel/geocoder";

// The planner API on the real database (12J.1): a firm's key made as the office's page stores it
// (its hash and hint, added as the superuser), requests as a planner sends them, and the API's
// dependencies with the test's clock, a fresh refused-key counter and a log that keeps its lines.

export const BASE = "localhost:3000"; // tests/setup/env.ts APP_BASE_DOMAIN

export const API_ENV = {
  INTEGRATIONS_SECRET: "test-only-integrations-secret-not-for-any-real-use",
  APP_BASE_DOMAIN: BASE,
  SESSION_SECRET: "test-only-secret-not-for-any-real-use-0123",
};

export async function plannerKey(
  su: Pool,
  firmId: string,
  createdBy: string,
): Promise<{ key: string; id: string }> {
  const key = newApiKey();
  const { rows } = await su.query<{ id: string }>(
    `insert into api_keys (firm_id, label, token_hash, hint, created_by)
     values ($1, 'Planner', $2, $3, $4) returning id::text as id`,
    [firmId, apiKeyHash(key), apiKeyHint(key), createdBy],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("api key insert returned no id");
  return { key, id };
}

export interface LogLine {
  level: string;
  msg: string;
  fields: Record<string, unknown>;
}

export function keptLog(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger: Logger = {
    info: (msg, fields = {}) => lines.push({ level: "info", msg, fields }),
    warn: (msg, fields = {}) => lines.push({ level: "warn", msg, fields }),
    error: (msg, fields = {}) => lines.push({ level: "error", msg, fields }),
    child: () => logger,
  };
  return { logger, lines };
}

export function apiDeps(o: {
  run: WithFirm;
  resolveKey: ResolveApiKey;
  now: () => Date;
  logger?: Logger;
  geocoder?: Geocoder;
  localDatabase?: boolean;
}): ApiDeps {
  return {
    run: o.run,
    resolveKey: o.resolveKey,
    now: o.now,
    env: API_ENV,
    geocoder: o.geocoder ?? fakeGeocoder,
    logger: o.logger ?? keptLog().logger,
    refusedKeys: createRefusedKeyCounter(),
    localDatabase: o.localDatabase ?? true,
    lastUsed: new Map(),
  };
}

// A request as a planner sends it: on the platform address, with its key, JSON for a body.
export function apiRequest(
  method: "GET" | "PUT",
  path: string,
  o: {
    key: string;
    body?: unknown;
    raw?: string; // a body sent as it is
    host?: string;
    contentType?: string;
    ip?: string;
  },
): Request {
  const body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  return new Request(`http://${BASE}${path}`, {
    method,
    headers: {
      host: o.host ?? BASE,
      authorization: `Bearer ${o.key}`,
      "x-real-ip": o.ip ?? "203.0.113.5",
      ...(body === undefined ? {} : { "content-type": o.contentType ?? "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

// The answer's JSON, with its status.
export async function answer<T = Record<string, unknown>>(
  response: Response,
): Promise<{ status: number; body: T; headers: Headers }> {
  return {
    status: response.status,
    body: (await response.json()) as T,
    headers: response.headers,
  };
}
