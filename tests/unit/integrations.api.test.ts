import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyEntry } from "@/lib/db/directory";
import { apiNotFound, handleApiRequest, type ApiCall, type ApiDeps } from "@/lib/integrations/api";
import { API_ERRORS } from "@/lib/integrations/errors";
import { newApiKey } from "@/lib/integrations/keys";
import { createRefusedKeyCounter, REFUSED_KEYS_PER_MINUTE } from "@/lib/integrations/refused-keys";
import {
  API_LIMITS,
  cancellationsQuery,
  decodeCursor,
  encodeCursor,
  fieldsOf,
  isRef,
  putSessionSchema,
  windowProblem,
} from "@/lib/integrations/schemas";
import { getSession, putSession } from "@/lib/integrations/sessions";
import type { Logger } from "@/lib/log";
import { eventWords } from "@/lib/office/event-words";
import { MAX_PAY_RATE_PENCE, MAX_REQUIREMENTS } from "@/lib/office/shift-editor";
import { RULE_CODES } from "@/lib/rules/eligibility";

// The planner API's boundary (docs/office-v2.md 5.3.2; 12J.1), without a database: every body
// field at its limits, refs, the cursor, the error shape, and every refusal handleApiRequest()
// makes before it asks the database anything. The calls themselves are tested on the real
// database (tests/integration/api.*.test.ts).

const BASE = "localhost:3000";
const ENV = {
  INTEGRATIONS_SECRET: "test-only-integrations-secret-not-for-any-real-use",
  APP_BASE_DOMAIN: BASE,
  SESSION_SECRET: "test-only-secret-not-for-any-real-use-0123",
};

const fields = (raw: unknown) => {
  const parsed = putSessionSchema.safeParse(raw);
  return parsed.success ? [] : fieldsOf(parsed.error);
};
const ok = (raw: unknown) => putSessionSchema.safeParse(raw).success;

describe("refs", () => {
  it("1 to 200 letters, digits, dots, underscores, colons and hyphens, ending with a letter or a digit", () => {
    for (const ref of ["A", "7", "RACEDAY-STW-0710", "a.b:c_d-e", "x".repeat(200), "AB"]) {
      expect(isRef(ref)).toBe(true);
    }
    for (const ref of [
      "",
      "x".repeat(201),
      "ABC.", // a full stop after a ref in a message is never part of it
      "ABC-",
      "ABC:",
      ".ABC",
      "-ABC",
      "A B",
      "A/B",
      "A%2FB",
      "Ünïcode",
    ]) {
      expect(isRef(ref)).toBe(false);
    }
  });
});

describe("the PUT body, field by field at its limits", () => {
  const at = (field: string, value: unknown) => fields({ [field]: value });

  it("the same limits as the office's editor", () => {
    expect(API_LIMITS.payRatePenceMax).toBe(MAX_PAY_RATE_PENCE);
    expect(API_LIMITS.requirements).toBe(MAX_REQUIREMENTS);
  });

  it("places 1 to 1000, whole", () => {
    expect(at("places", 1)).toEqual([]);
    expect(at("places", 1000)).toEqual([]);
    expect(at("places", 0)).toEqual([{ path: "places", code: "too_small" }]);
    expect(at("places", 1001)).toEqual([{ path: "places", code: "too_big" }]);
    expect(at("places", 1.5)).toEqual([{ path: "places", code: "invalid_type" }]);
    expect(at("places", "6")).toEqual([{ path: "places", code: "invalid_type" }]);
  });

  it("pay in whole pence, 0 to 100,000 (£1,000 an hour), or null", () => {
    expect(at("pay_rate_pence", 0)).toEqual([]);
    expect(at("pay_rate_pence", 100_000)).toEqual([]);
    expect(at("pay_rate_pence", null)).toEqual([]);
    expect(at("pay_rate_pence", -1)).toEqual([{ path: "pay_rate_pence", code: "too_small" }]);
    expect(at("pay_rate_pence", 100_001)).toEqual([{ path: "pay_rate_pence", code: "too_big" }]);
    expect(at("pay_rate_pence", 12.6)).toEqual([{ path: "pay_rate_pence", code: "invalid_type" }]);
  });

  it.each([
    ["post", 200],
    ["meeting_point", 300],
    ["uniform", 300],
    ["instructions", 2000],
  ])("%s up to %i characters, trimmed; blank or null clears it", (field, max) => {
    expect(at(field, "x".repeat(max))).toEqual([]);
    expect(at(field, ` ${"x".repeat(max)} `)).toEqual([]);
    expect(at(field, "x".repeat(max + 1))).toEqual([{ path: field, code: "too_big" }]);
    expect(putSessionSchema.parse({ [field]: "   " })).toEqual({ [field]: null });
    expect(putSessionSchema.parse({ [field]: null })).toEqual({ [field]: null });
  });

  it("the event: a ref and a name of 1 to 200 characters; never an automatic event's key", () => {
    expect(at("event", { ref: "RACEDAY-2026", name: "x".repeat(200) })).toEqual([]);
    expect(at("event", null)).toEqual([]);
    expect(at("event", { ref: "RACEDAY-2026", name: "x".repeat(201) })).toEqual([
      { path: "event.name", code: "too_big" },
    ]);
    expect(at("event", { ref: "RACEDAY-2026", name: "  " })).toEqual([
      { path: "event.name", code: "too_small" },
    ]);
    expect(at("event", { ref: "RACEDAY.", name: "Raceday" })).toEqual([
      { path: "event.ref", code: "bad_ref" },
    ]);
    expect(at("event", { ref: "auto:x:2026-10-07", name: "Raceday" })).toEqual([
      { path: "event.ref", code: "reserved_ref" },
    ]);
    expect(at("event", { ref: "AUTO:1", name: "Raceday" })).toEqual([
      { path: "event.ref", code: "reserved_ref" },
    ]);
    expect(at("event", { name: "Raceday" })).toEqual([{ path: "event.ref", code: "invalid_type" }]);
  });

  it("the site: a name of 1 to 200 characters and a UK postcode, tidied", () => {
    expect(
      putSessionSchema.parse({ site: { name: " Acme Demo Racecourse ", postcode: "zz9  9zz" } }),
    ).toEqual({
      site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
    });
    expect(at("site", { name: "x".repeat(200) })).toEqual([]);
    expect(at("site", { name: "x".repeat(201) })).toEqual([{ path: "site.name", code: "too_big" }]);
    expect(at("site", { name: "Arena", postcode: null })).toEqual([]);
    expect(at("site", { name: "Arena", postcode: "NOT A CODE" })).toEqual([
      { path: "site.postcode", code: "bad_postcode" },
    ]);
    expect(at("site", { name: "Arena", postcode: "ZZ9 9ZZ      X" })).toEqual([
      { path: "site.postcode", code: "too_big" },
    ]);
    // A site can't be cleared: it's shared, and a session from the planner always has one.
    expect(at("site", null)).toEqual([{ path: "site", code: "invalid_type" }]);
  });

  it("the role as the sheet parser reads it, up to 100 characters", () => {
    expect(putSessionSchema.parse({ role: "  Door supervisor " })).toEqual({
      role: "door_supervisor",
    });
    expect(putSessionSchema.parse({ role: "steward" })).toEqual({ role: "steward" });
    expect(at("role", "!!")).toEqual([{ path: "role", code: "bad_role" }]);
    expect(at("role", "")).toEqual([{ path: "role", code: "too_small" }]);
    expect(at("role", "a".repeat(101))).toEqual([{ path: "role", code: "too_big" }]);
  });

  it("at most 20 requirements, as upper-case codes, each once and in order", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `CODE_${i}`);
    expect(at("requirements", twenty)).toEqual([]);
    expect(at("requirements", [...twenty, "ONE_MORE"])).toEqual([
      { path: "requirements", code: "too_big" },
    ]);
    expect(putSessionSchema.parse({ requirements: ["sia_ds", "CSAS", "SIA_DS"] })).toEqual({
      requirements: ["CSAS", "SIA_DS"],
    });
    expect(at("requirements", ["1X"])).toEqual([{ path: "requirements.0", code: "bad_code" }]);
    expect(at("requirements", ["X".repeat(51)])).toEqual([
      { path: "requirements.0", code: "too_big" },
    ]);
    expect(putSessionSchema.parse({ requirements: null })).toEqual({ requirements: null });
  });

  it("times in ISO 8601 with an offset, in whole minutes", () => {
    expect(putSessionSchema.parse({ starts_at: "2026-10-07T10:30:00+01:00" })).toEqual({
      starts_at: new Date("2026-10-07T09:30:00Z"),
    });
    expect(at("ends_at", "2026-10-07T18:30:00Z")).toEqual([]);
    expect(at("starts_at", "2026-10-07T10:30:00")).toEqual([
      { path: "starts_at", code: "invalid_format" },
    ]);
    expect(at("starts_at", "07/10/2026 10:30")).toEqual([
      { path: "starts_at", code: "invalid_format" },
    ]);
    expect(at("starts_at", "2026-10-07T10:30:15+01:00")).toEqual([
      { path: "starts_at", code: "whole_minutes" },
    ]);
  });

  it("a finish after the start and less than 24 hours later", () => {
    const start = new Date("2026-10-07T09:30:00Z");
    const later = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    expect(windowProblem(start, later(1))).toBeNull();
    expect(windowProblem(start, later(24 * 60 - 1))).toBeNull();
    expect(windowProblem(start, start)).toEqual({ path: "ends_at", code: "not_after_start" });
    expect(windowProblem(start, later(-60))).toEqual({ path: "ends_at", code: "not_after_start" });
    expect(windowProblem(start, later(24 * 60))).toEqual({
      path: "ends_at",
      code: "over_24_hours",
    });
  });

  it("status open or cancelled; a change reason for a whole session", () => {
    expect(at("status", "open")).toEqual([]);
    expect(at("status", "cancelled")).toEqual([]);
    expect(at("status", "filled")).toEqual([{ path: "status", code: "invalid_value" }]);
    for (const code of ["event_changed", "event_cancelled", "fewer_staff", "weather", "other"]) {
      expect(at("change_reason", code)).toEqual([]);
    }
    // One person's booking only: never a whole session's.
    expect(at("change_reason", "not_available")).toEqual([
      { path: "change_reason", code: "invalid_value" },
    ]);
  });

  it("an unknown field is a 400, named by its path: the showing switches and urgent are the office's", () => {
    expect(fields({ places: 2, urgent: true, showing_to_casuals: false })).toEqual([
      { path: "urgent", code: "unrecognized_key" },
      { path: "showing_to_casuals", code: "unrecognized_key" },
    ]);
    expect(fields({ site: { name: "Arena", town: "Leeds" } })).toEqual([
      { path: "site.town", code: "unrecognized_key" },
    ]);
    // A name that isn't a plain field name isn't repeated back.
    expect(fields({ "<script>": 1 })).toEqual([{ path: "?", code: "unrecognized_key" }]);
    expect(fields(JSON.parse('{"__proto__": {"x": 1}}'))).toEqual([
      { path: "__proto__", code: "unrecognized_key" },
    ]);
    expect(fields([])).toEqual([{ path: "", code: "invalid_type" }]);
  });

  it("the whole example body from docs/office-v2.md 5.3.2 passes", () => {
    expect(
      ok({
        event: { ref: "RACEDAY-2026", name: "Raceday" },
        site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
        role: "steward",
        starts_at: "2026-10-07T10:30:00+01:00",
        ends_at: "2026-10-07T18:30:00+01:00",
        places: 6,
        status: "open",
        pay_rate_pence: 1260,
        post: "Gate B",
        meeting_point: "Staff entrance, Gate B",
        uniform: "Black trousers, boots. Hi-vis provided.",
        requirements: ["CSAS"],
        instructions: "Ask for the steward lead on arrival.",
        change_reason: "event_changed",
      }),
    ).toBe(true);
  });

  it("a refusal names paths and codes, never a value sent", () => {
    const value = "ZZ-SENT-VALUE-0731";
    const out = JSON.stringify(
      fields({
        role: `${value}!!`,
        post: value.repeat(20),
        places: value,
        status: value,
        site: { name: value, postcode: value },
        event: { ref: `${value}.`, name: value },
        requirements: [value.toLowerCase().replace(/-/g, " ")],
        starts_at: value,
        change_reason: value,
      }),
    );
    expect(out).not.toContain(value);
    expect(out).not.toContain(value.toLowerCase());
  });
});

describe("the cancellations query", () => {
  const url = (query: string) => new URL(`http://${BASE}/api/v1/cancellations${query}`);
  const cursor = { t: "2026-11-02T09:00:00.123456Z", b: "0b9e8a52-2b7a-4b1e-9c55-6c1d7f3e2a10" };

  it("since= as an ISO time with an offset, or cursor=, exactly one", () => {
    expect(cancellationsQuery(url("?since=2026-11-02T09:00:00Z"))).toEqual({
      from: "since",
      since: new Date("2026-11-02T09:00:00Z"),
    });
    expect(cancellationsQuery(url("?since=2026-11-02T09:00:00%2B01:00"))).toEqual({
      from: "since",
      since: new Date("2026-11-02T08:00:00Z"),
    });
    expect(cancellationsQuery(url(`?cursor=${encodeCursor(cursor)}`))).toEqual({
      from: "cursor",
      cursor,
    });
    expect(cancellationsQuery(url(""))).toEqual({ problem: "bad_since" });
    expect(cancellationsQuery(url("?since=yesterday"))).toEqual({ problem: "bad_since" });
    expect(cancellationsQuery(url("?since=2026-11-02T09:00:00"))).toEqual({ problem: "bad_since" });
    expect(
      cancellationsQuery(url(`?since=2026-11-02T09:00:00Z&cursor=${encodeCursor(cursor)}`)),
    ).toEqual({ problem: "bad_since" });
    expect(cancellationsQuery(url("?cursor=abc"))).toEqual({ problem: "bad_cursor" });
  });

  it("a cursor is opaque base64url, and only the exact form ShiftDesk gives is taken", () => {
    const c = encodeCursor(cursor);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(cursor);
    const json = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(decodeCursor(json({ ...cursor, extra: 1 }))).toBeNull();
    expect(decodeCursor(json({ t: "2026-11-02T09:00:00Z", b: cursor.b }))).toBeNull();
    expect(decodeCursor(json({ b: cursor.b, t: cursor.t }))).toBeNull(); // not the form given
    expect(decodeCursor(json({ t: cursor.t, b: "not-a-uuid" }))).toBeNull();
    expect(decodeCursor(`${c}=`)).toBeNull();
    expect(decodeCursor("x".repeat(201))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("the refused-key counter", () => {
  it("30 a minute per address, then a wait until the minute ends; other addresses and the next minute are free", () => {
    const counter = createRefusedKeyCounter();
    const t0 = Date.UTC(2026, 10, 2, 9, 0, 15);
    for (let i = 0; i < REFUSED_KEYS_PER_MINUTE; i++) {
      expect(counter.blocked("203.0.113.5", t0)).toBeNull();
      counter.note("203.0.113.5", t0);
    }
    expect(counter.blocked("203.0.113.5", t0)).toEqual({ retryAfterSeconds: 45 });
    expect(counter.blocked("203.0.113.5", t0 + 44_500)).toEqual({ retryAfterSeconds: 1 });
    expect(counter.blocked("203.0.113.6", t0)).toBeNull();
    expect(counter.blocked("203.0.113.5", t0 + 45_000)).toBeNull();
  });

  it("counts at most so many addresses in a minute (memory stays bounded)", () => {
    const counter = createRefusedKeyCounter({ max: 1, maxAddresses: 2 });
    const t = 0;
    counter.note("a", t);
    counter.note("b", t);
    counter.note("c", t);
    expect(counter.blocked("a", t)).not.toBeNull();
    expect(counter.blocked("c", t)).toBeNull();
    counter.reset();
    expect(counter.blocked("a", t)).toBeNull();
  });
});

// --- handleApiRequest before any look-up ---

function capture(): { logger: Logger; lines: { level: string; msg: string; fields: object }[] } {
  const lines: { level: string; msg: string; fields: object }[] = [];
  const logger: Logger = {
    info: (msg, f = {}) => lines.push({ level: "info", msg, fields: f }),
    warn: (msg, f = {}) => lines.push({ level: "warn", msg, fields: f }),
    error: (msg, f = {}) => lines.push({ level: "error", msg, fields: f }),
    child: () => logger,
  };
  return { logger, lines };
}

const NOW = new Date("2026-11-02T09:00:15Z");

function setup(o: { entry?: ApiKeyEntry | null; env?: Partial<typeof ENV> } = {}) {
  const resolveKey = vi.fn(async () => o.entry ?? null);
  const run = vi.fn(async () => {
    throw new Error("no database in this test");
  });
  const { logger, lines } = capture();
  const deps: ApiDeps = {
    env: { ...ENV, ...o.env },
    resolveKey,
    run: run as unknown as ApiDeps["run"],
    now: () => NOW,
    logger,
    refusedKeys: createRefusedKeyCounter(),
    localDatabase: true,
  };
  const handler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
  const call = (
    r: {
      host?: string;
      key?: string | null;
      ip?: string;
      authorization?: string;
      id?: string;
    } = {},
  ) =>
    handleApiRequest(
      new Request(`http://${BASE}/api/v1/cancellations?since=2026-11-01T00:00:00Z`, {
        headers: {
          host: r.host ?? BASE,
          "x-real-ip": r.ip ?? "203.0.113.5",
          ...(r.id ? { "x-request-id": r.id } : {}),
          ...(r.authorization
            ? { authorization: r.authorization }
            : r.key === null
              ? {}
              : { authorization: `Bearer ${r.key ?? newApiKey()}` }),
        },
      }),
      { route: "/api/v1/cancellations", method: "GET", body: false, handler },
      deps,
    );
  return { deps, resolveKey, run, handler, lines, call };
}

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; request_id: string } })
    .error;

describe("handleApiRequest: the refusals before any look-up", () => {
  it("answers on the platform address only: a firm's subdomain, its own domain or any other host get 404", async () => {
    const s = setup();
    for (const host of [
      "acme.localhost:3000",
      "shifts.acme-events.test:3000",
      "shifts.acme-events.test",
      "evil.example",
      "localhost:3001",
    ]) {
      const response = await s.call({ host });
      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe("not_found");
    }
    expect(s.resolveKey).not.toHaveBeenCalled();
    // The platform address goes on to the key (a made-up key: 401).
    expect((await s.call({ host: "LOCALHOST:3000" })).status).toBe(401);
    expect(s.resolveKey).toHaveBeenCalledTimes(1);
  });

  it("without INTEGRATIONS_SECRET every call is 503 not_configured", async () => {
    const s = setup({ env: { INTEGRATIONS_SECRET: undefined } });
    const response = await s.call();
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toMatchObject({
      code: "not_configured",
      message: API_ERRORS.not_configured.message,
    });
    expect(s.resolveKey).not.toHaveBeenCalled();
  });

  it("a missing key, a key of the wrong shape or not a Bearer one: 401 without a look-up", async () => {
    const s = setup();
    const key = newApiKey();
    for (const authorization of [
      undefined,
      `Basic ${key}`,
      `Bearer ${key.slice(0, -1)}`,
      `Bearer ${key}x`,
      `Bearer ${key.replace("shiftdesk_", "shiftdesk-")}`,
      `Bearer ${key.slice(0, -1)}+`,
      "Bearer",
    ]) {
      const response = await s.call(authorization ? { authorization } : { key: null });
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe("invalid_key");
    }
    expect(s.resolveKey).not.toHaveBeenCalled();
    expect(s.run).not.toHaveBeenCalled();
  });

  it("the 31st refused key in a minute from one address gets 429 before any look-up; another address is unaffected", async () => {
    const s = setup();
    // Wrong shapes and right-shaped keys nobody has both count.
    for (let i = 0; i < REFUSED_KEYS_PER_MINUTE; i++) {
      const response = await s.call(i % 2 === 0 ? { authorization: "Bearer nope" } : {});
      expect(response.status).toBe(401);
    }
    expect(s.resolveKey).toHaveBeenCalledTimes(REFUSED_KEYS_PER_MINUTE / 2);
    s.resolveKey.mockClear();
    const limited = await s.call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("45");
    expect((await errorOf(limited)).code).toBe("rate_limited");
    expect(s.resolveKey).not.toHaveBeenCalled();
    expect((await s.call({ ip: "198.51.100.7" })).status).toBe(401);
    expect(s.resolveKey).toHaveBeenCalledTimes(1);
  });

  it("an unknown key and a revoked one get the same 401", async () => {
    const s = setup({ entry: null });
    const a = await s.call();
    const b = await s.call();
    expect([a.status, b.status]).toEqual([401, 401]);
    const [ea, eb] = [await errorOf(a), await errorOf(b)];
    expect(ea.message).toBe(eb.message);
  });

  it("every error is {error: {code, message, request_id}}, the id the proxy gave the request", async () => {
    const s = setup();
    const id = "4f1c0e2a-1b2c-4d3e-8f90-0a1b2c3d4e5f";
    const response = await s.call({ key: null, id });
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe(id);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      error: { code: "invalid_key", message: API_ERRORS.invalid_key.message, request_id: id },
    });
  });

  it("one log line per request: route, method, status, ms; never the key, the header or the address", async () => {
    const s = setup();
    const key = newApiKey();
    await s.call({ key });
    await s.call({ host: "acme.localhost:3000", key });
    expect(s.lines).toHaveLength(2);
    expect(s.lines.map((l) => l.fields)).toEqual([
      expect.objectContaining({ route: "/api/v1/cancellations", method: "GET", status: 401 }),
      expect.objectContaining({ route: "/api/v1/cancellations", method: "GET", status: 404 }),
    ]);
    const text = JSON.stringify(s.lines);
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(10));
    expect(text).not.toMatch(/bearer|authorization/i);
    expect(text).not.toContain("203.0.113.5");
    expect(text).not.toContain("since=");
  });

  it("an unknown /api/v1 address is a JSON 404 with no look-up", async () => {
    const { logger, lines } = capture();
    const response = apiNotFound(
      new Request(`http://${BASE}/api/v1/shifts`, { headers: { host: BASE } }),
      "GET",
      { logger },
    );
    expect(response.status).toBe(404);
    expect((await errorOf(response)).code).toBe("not_found");
    expect(lines).toHaveLength(1);
  });
});

describe("the sessions' handlers before the database", () => {
  const call = (json?: unknown): ApiCall => ({
    firmId: "00000000-0000-4000-8000-000000000001",
    keyId: "00000000-0000-4000-8000-000000000002",
    requestId: "r",
    now: NOW,
    json,
    url: new URL(`http://${BASE}/api/v1/sessions/X`),
    run: () => {
      throw new Error("no database in this test");
    },
    localDatabase: true,
  });

  it('a ref ending in "." is 400 bad_ref (the proxy never trims an /api/ path)', async () => {
    for (const ref of ["RACEDAY-STW-0710.", "A,", "A)", "-A", "x".repeat(201)]) {
      expect((await putSession(call({ places: 2 }), ref)).body).toMatchObject({
        error: { code: "bad_ref" },
      });
      expect((await getSession(call(), ref)).status).toBe(400);
    }
  });

  it("a body that isn't right is 400 validation_failed with its fields, never a value", async () => {
    const result = await putSession(
      call({ role: "x".repeat(101), places: "Zz-VALUE-99", colour: "red" }),
      "RACEDAY-STW-0710",
    );
    expect(result).toEqual({
      status: 400,
      body: {
        error: {
          code: "validation_failed",
          message: API_ERRORS.validation_failed.message,
          fields: [
            { path: "role", code: "too_big" },
            { path: "places", code: "invalid_type" },
            { path: "colour", code: "unrecognized_key" },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/Zz-VALUE-99|red|xxxx/);
  });
});

describe("the error list", () => {
  it("every message is one plain sentence or two, and none can hold a value", () => {
    for (const [code, { status, message }] of Object.entries(API_ERRORS)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(message).toMatch(/^[A-Z].*[.]$/);
      expect(message).not.toMatch(/[{}$]/);
    }
  });
});

describe("docs/integrations.md", () => {
  const doc = readFileSync(join(process.cwd(), "docs/integrations.md"), "utf8");

  it("lists every error code with its status, and nothing else", () => {
    const rows = [...doc.matchAll(/^\| (\d{3}) \| `([a-z_]+)` \|/gm)].map((m) => [
      m[2],
      Number(m[1]),
    ]);
    expect(Object.fromEntries(rows)).toEqual(
      Object.fromEntries(Object.entries(API_ERRORS).map(([code, e]) => [code, e.status])),
    );
  });

  it("lists every rules code a refused move can give", () => {
    const section = doc.slice(doc.indexOf("**The rules' codes**"));
    for (const code of RULE_CODES) expect(section).toContain(`\`${code}\``);
  });

  it("never holds a key of the real shape", () => {
    expect(doc).not.toMatch(/shiftdesk_[A-Za-z0-9_-]{43}/);
  });
});

describe("the planner's entries in the action log", () => {
  const names = {
    worker: () => "Ann Booker",
    office: () => "Sam Rota",
    site: () => "Riverside Arena",
  };
  const api = { by: "firm", via: "api", keyId: "00000000-0000-4000-8000-000000000003" };
  const say = (action: string, data: Record<string, unknown>) =>
    eventWords({ action, actorType: "system", actorId: null, data: { ...api, ...data } }, names);

  it("say what the planner did, never a key", () => {
    expect(say("api.change_refused", { code: "places_below_booked" })).toBe(
      "Your planner's change was refused: a booking holds a place above the new number of places.",
    );
    expect(say("api.change_refused", { code: "session_has_bookings" })).toBe(
      "Your planner's change was refused: casuals are booked, so its role and requirements can't change.",
    );
    expect(say("api.change_refused", { code: "change_reason_required" })).toBe(
      "Your planner's change was refused: it moved or cancelled a session with casuals booked, and gave no reason.",
    );
    expect(say("shift.changed", { fields: ["headcount", "payRatePence", "eventName"] })).toBe(
      "Your planner: Changed the places, pay rate and event name.",
    );
    expect(say("site.created", {})).toBe("Your planner added a site.");
    expect(say("site.changed", { siteId: "s", fields: ["postcode"] })).toBe(
      "Your planner gave Riverside Arena its postcode.",
    );
    expect(say("shift.reopened", {})).toBe(
      "Your planner's change opened it again: it has more places than bookings.",
    );
    expect(
      eventWords(
        {
          action: "auth.rate_limited",
          actorType: "system",
          actorId: null,
          data: { limit: "api:key" },
        },
        names,
      ),
    ).toBe("Too many calls from your planner: its API key was paused for the rest of the minute.");
  });
});
