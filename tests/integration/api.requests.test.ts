import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createKeyDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { MAX_BODY_BYTES, type ApiDeps } from "@/lib/integrations/api";
import { getCancellationsRequest } from "@/lib/integrations/cancellations";
import { getSessionRequest, putSessionRequest } from "@/lib/integrations/sessions";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { answer, apiDeps, apiRequest, BASE, keptLog, plannerKey } from "../helpers/planner-api";

// What every planner API call goes through (handleApiRequest(), docs/office-v2.md 5.3.2; 12J.1), on
// the real database as the app role: the platform address only, the body's type and size, the
// key's look-up, 300 calls a minute per key, a revoked key, last_used_at, and the one log line.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let resolveKey: ReturnType<typeof createKeyDirectory>;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
  resolveKey = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function plannerFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const key = await plannerKey(su, f.firmId, admin);
  const log = keptLog();
  let now = NOW;
  const deps: ApiDeps = apiDeps({ run: withFirm, resolveKey, now: () => now, logger: log.logger });
  const at = (when: Date) => {
    now = when;
  };
  return { f, admin, key, deps, log, at };
}

const SINCE = "/api/v1/cancellations?since=2026-11-01T00:00:00Z";
const BODY = {
  site: { name: "Riverside Arena" },
  role: "steward",
  starts_at: "2026-11-07T08:00:00Z",
  ends_at: "2026-11-07T16:00:00Z",
};

describe("the platform address only", () => {
  it("answers there; a firm's subdomain and a custom domain give 404, whatever the key", async () => {
    const t = await plannerFirm();
    const get = async (host: string) =>
      (await getCancellationsRequest(apiRequest("GET", SINCE, { key: t.key.key, host }), t.deps))
        .status;
    expect(await get(BASE)).toBe(200);
    expect(await get(`${t.f.firmId.slice(0, 8)}.${BASE}`)).toBe(404);
    const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
      t.f.firmId,
    ]);
    expect(await get(`${rows[0]?.slug}.${BASE}`)).toBe(404);
    expect(await get("shifts.acme-events.test:3000")).toBe(404);
    expect(await get("shifts.acme-events.test")).toBe(404);
  });
});

describe("the body", () => {
  it("JSON only (415), at most 64 KB (413, declared or not), and valid JSON (400 bad_json)", async () => {
    const t = await plannerFirm();
    const put = async (o: { raw?: string; body?: unknown; contentType?: string }) =>
      answer<{ error?: { code: string } }>(
        await putSessionRequest(
          apiRequest("PUT", "/api/v1/sessions/S-1", { key: t.key.key, ...o }),
          "S-1",
          t.deps,
        ),
      );
    const json = JSON.stringify(BODY);
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/jsonx",
    ]) {
      const r = await put({ raw: json, contentType });
      expect([r.status, r.body.error?.code]).toEqual([415, "not_json"]);
    }
    expect((await put({ raw: json, contentType: "application/json; charset=utf-8" })).status).toBe(
      201,
    );
    // Padding inside a field: over 64 KB in all.
    const big = JSON.stringify({ ...BODY, instructions: "x".repeat(MAX_BODY_BYTES) });
    expect(await put({ raw: big })).toMatchObject({
      status: 413,
      body: { error: { code: "too_big" } },
    });
    // Sent as a stream, with no length declared.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array(1024).fill(32));
        c.close();
      },
    });
    const streamed = await putSessionRequest(
      new Request(`http://${BASE}/api/v1/sessions/S-1`, {
        method: "PUT",
        headers: {
          host: BASE,
          authorization: `Bearer ${t.key.key}`,
          "content-type": "application/json",
        },
        body: stream,
        duplex: "half",
      } as RequestInit),
      "S-1",
      t.deps,
    );
    expect(streamed.status).toBe(413);
    for (const raw of ["", "{", "{'role': 'steward'}", "[1, 2"]) {
      expect(await put({ raw })).toMatchObject({
        status: 400,
        body: { error: { code: "bad_json" } },
      });
    }
    // Not UTF-8.
    const latin1 = await putSessionRequest(
      new Request(`http://${BASE}/api/v1/sessions/S-1`, {
        method: "PUT",
        headers: {
          host: BASE,
          authorization: `Bearer ${t.key.key}`,
          "content-type": "application/json",
        },
        body: new Uint8Array([0x7b, 0x22, 0xe9, 0x22, 0x3a, 0x31, 0x7d]),
      }),
      "S-1",
      t.deps,
    );
    expect(latin1.status).toBe(400);
  });
});

describe("the key", () => {
  it("300 calls a minute per key: the 301st is 429 with Retry-After, another key is unaffected, the next minute is open", async () => {
    const t = await plannerFirm();
    const other = await plannerKey(su, t.f.firmId, t.admin);
    const get = async (key = t.key.key) =>
      getSessionRequest(apiRequest("GET", "/api/v1/sessions/NOPE", { key }), "NOPE", t.deps);
    for (let i = 0; i < 300; i++) expect((await get()).status).toBe(404);
    const limited = await answer<{ error: { code: string } }>(await get());
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await get(other.key)).status).toBe(404);
    // Logged once a window, when the limit is reached.
    const { rows } = await su.query(
      `select entity_type, entity_id::text, data from events
        where firm_id = $1 and action = 'auth.rate_limited'`,
      [t.f.firmId],
    );
    // Under the key that reached it (its id, never the key).
    expect(rows).toEqual([
      { entity_type: "api_key", entity_id: t.key.id, data: { limit: "api:key" } },
    ]);
    t.at(new Date(NOW.getTime() + MINUTE));
    expect((await get()).status).toBe(404);
  });

  it("a revoked key gives 401 at once, the same answer as a key nobody has", async () => {
    const t = await plannerFirm();
    const get = async () =>
      answer<{ error?: { code: string; message: string } }>(
        await getCancellationsRequest(apiRequest("GET", SINCE, { key: t.key.key }), t.deps),
      );
    expect((await get()).status).toBe(200);
    await su.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
      t.key.id,
      t.admin,
    ]);
    const revoked = await get();
    expect([revoked.status, revoked.body.error?.code]).toEqual([401, "invalid_key"]);
    const unknown = await answer<{ error?: { code: string; message: string } }>(
      await getCancellationsRequest(
        apiRequest("GET", SINCE, { key: `shiftdesk_${"A".repeat(43)}` }),
        t.deps,
      ),
    );
    expect(unknown.body.error?.message).toBe(revoked.body.error?.message);
  });

  it("last_used_at is written at most once a minute", async () => {
    const t = await plannerFirm();
    const used = async () =>
      (
        await su.query<{ last_used_at: Date | null }>(
          "select last_used_at from api_keys where id = $1",
          [t.key.id],
        )
      ).rows[0]?.last_used_at;
    expect(await used()).toBeNull();
    const call = () =>
      getCancellationsRequest(apiRequest("GET", SINCE, { key: t.key.key }), t.deps);
    await call();
    expect(await used()).toEqual(NOW);
    t.at(new Date(NOW.getTime() + 30_000));
    await call();
    expect(await used()).toEqual(NOW);
    t.at(new Date(NOW.getTime() + MINUTE));
    await call();
    expect(await used()).toEqual(new Date(NOW.getTime() + MINUTE));
  });
});

describe("the log", () => {
  it("one line per request with route, status, ms, firm and key id: never the key, the header or the body", async () => {
    const t = await plannerFirm();
    await putSessionRequest(
      apiRequest("PUT", "/api/v1/sessions/S-1", {
        key: t.key.key,
        body: { ...BODY, instructions: "Ask for Kieran at the gate." },
      }),
      "S-1",
      t.deps,
    );
    await getSessionRequest(
      apiRequest("GET", "/api/v1/sessions/S-1", { key: t.key.key }),
      "S-1",
      t.deps,
    );
    expect(t.log.lines.map((l) => [l.level, l.msg, l.fields])).toEqual([
      [
        "info",
        "api request",
        {
          requestId: expect.any(String),
          route: "/api/v1/sessions/{ref}",
          method: "PUT",
          status: 201,
          ms: expect.any(Number),
          firmId: t.f.firmId,
          keyId: t.key.id,
        },
      ],
      [
        "info",
        "api request",
        expect.objectContaining({ route: "/api/v1/sessions/{ref}", method: "GET", status: 200 }),
      ],
    ]);
    const text = JSON.stringify(t.log.lines);
    expect(text).not.toContain(t.key.key);
    expect(text).not.toContain(t.key.key.slice(10, 30));
    expect(text).not.toMatch(/bearer|authorization|Kieran|S-1|Riverside/i);
  });
});
