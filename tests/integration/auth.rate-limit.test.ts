import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MINUTE } from "@/lib/auth/clock";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { hitLimit, LIMITS } from "@/lib/auth/throttle";
import { consumeWorkerLoginLink, requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { withFirm, type WithFirm } from "@/lib/db/scoped";
import { captureTransport, eventMark, eventsFor, mobileOf, tokenFrom } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { fulfilled, race } from "../helpers/race";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Login rate limits: 3 links per number and 10 per IP every 15 minutes, 20 link uses per IP.

const SECRET = "test-only-secret-not-for-any-real-use-0123";
const t0 = new Date("2026-10-01T09:00:00.000Z"); // the start of a 15-minute window
const at = (ms: number) => ({ now: () => new Date(t0.getTime() + ms) });

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

const request = (T: Tenant, mobile: string, opts: { ms?: number; ip?: string } = {}) =>
  requestWorkerLoginLink(
    { firm: { id: T.firmId }, clientIp: opts.ip ?? freshIp(), clock: at(opts.ms ?? 0) },
    mobile,
  );

describe("per number", () => {
  it("3 links per number every 15 minutes; the 4th is refused with the wait; the next window is open", async () => {
    const T = await createTenant(su);
    const mobile = await mobileOf(su, T.workerId);
    for (let i = 0; i < 3; i++) expect(await request(T, mobile)).toEqual({ status: "sent" });
    expect(await request(T, mobile, { ms: 5 * MINUTE })).toEqual({
      status: "rate_limited",
      retryAfterMinutes: 10,
    });
    expect(await request(T, mobile, { ms: 15 * MINUTE - 1 })).toMatchObject({
      status: "rate_limited",
    });
    expect(await request(T, mobile, { ms: 15 * MINUTE })).toEqual({ status: "sent" });
  });

  it("the limit looks exactly the same for a worker's number and an unknown one", async () => {
    const T = await createTenant(su);
    const known = await mobileOf(su, T.workerId);
    const unknown = "+447700900998";
    for (let i = 0; i < 3; i++) {
      expect(await request(T, known)).toEqual(await request(T, unknown));
    }
    expect(await request(T, known)).toEqual(await request(T, unknown));
    expect(await request(T, known)).toMatchObject({ status: "rate_limited" });
  });
});

describe("a refused IP can't lock anyone else out", () => {
  it("requests refused by the IP limit don't count against the numbers they name", async () => {
    const T = await createTenant(su);
    const victim = await mobileOf(su, T.workerId);
    const attacker = freshIp();
    for (let i = 0; i < 10; i++) await request(T, "junk", { ip: attacker }); // uses up the IP
    for (let i = 0; i < 3; i++) {
      expect(await request(T, victim, { ip: attacker })).toMatchObject({ status: "rate_limited" });
    }
    // The worker, from their own phone, is not locked out.
    expect(await request(T, victim, { ip: freshIp() })).toEqual({ status: "sent" });
    const numberRows = await su.query(
      "select hits from auth_throttle where firm_id = $1 and bucket like 'login:mobile:%'",
      [T.firmId],
    );
    expect(numberRows.rows).toEqual([{ hits: 1 }]);
  });
});

describe("per IP", () => {
  it("10 requests per IP across different numbers; the 11th is refused", async () => {
    const T = await createTenant(su);
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect(await request(T, `+4477009007${String(i).padStart(2, "0")}`, { ip })).toEqual({
        status: "sent",
      });
    }
    expect(await request(T, "+447700900799", { ip })).toMatchObject({ status: "rate_limited" });
    expect(await request(T, "+447700900799", { ip: freshIp() })).toEqual({ status: "sent" });
  });

  it("junk counts against the IP too", async () => {
    const T = await createTenant(su);
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect(await request(T, "not a number", { ip })).toEqual({ status: "invalid_number" });
    }
    expect(await request(T, await mobileOf(su, T.workerId), { ip })).toMatchObject({
      status: "rate_limited",
    });
  });

  it("successful logins don't count: a crew on one venue Wi-Fi can all log in", async () => {
    const T = await createTenant(su);
    const ip = freshIp();
    for (let i = 0; i < 25; i++) {
      const { transport, sent } = captureTransport();
      await withFirm(T.firmId, (tx) =>
        sendPortalLink(
          {
            firmId: T.firmId,
            idempotencyKey: randomUUID(),
            purpose: "worker_login",
            subjectId: T.workerId,
          },
          tx,
          { transport, clock: at(0), baseDomain: "localhost:3000" },
        ),
      );
      const result = await consumeWorkerLoginLink(
        { firm: { id: T.firmId }, clientIp: ip, clock: at(0) },
        tokenFrom(sent[0]),
      );
      expect(result.status).toBe("ok");
    }
  });

  it("using links: 20 failed attempts per IP, then refused", async () => {
    const T = await createTenant(su);
    const ctx = { firm: { id: T.firmId }, clientIp: freshIp(), clock: at(0) };
    for (let i = 0; i < 20; i++) {
      expect(await consumeWorkerLoginLink(ctx, "x".repeat(43))).toEqual({ status: "rejected" });
    }
    expect(await consumeWorkerLoginLink(ctx, "x".repeat(43))).toMatchObject({
      status: "rate_limited",
    });
  });
});

describe("counting", () => {
  it("counts before the real work, so a request that then fails still counts", async () => {
    const T = await createTenant(su);
    const mobile = await mobileOf(su, T.workerId);
    const ip = freshIp();
    let calls = 0;
    const failing: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls % 2 === 0) throw new Error("the real work failed");
      return withFirm(firmId, fn);
    };
    for (let i = 0; i < 3; i++) {
      await expect(
        requestWorkerLoginLink(
          { firm: { id: T.firmId }, clientIp: ip, clock: at(0), run: failing },
          mobile,
        ),
      ).rejects.toThrow("the real work failed");
    }
    expect(await request(T, mobile)).toMatchObject({ status: "rate_limited" });
  });

  it("10 at the same moment: exactly 3 allowed (control: read-then-write loses counts)", async () => {
    const T = await createTenant(su);
    const now = new Date(t0.getTime() + MINUTE);

    const naive = await race(10, T.firmId, async (tx) => {
      const bucket = "naive:bucket";
      const { rows } = await tx.execute<{ hits: number }>(
        sql`select hits from auth_throttle where bucket = ${bucket} and window_start = ${t0}`,
      );
      const hits = (rows[0]?.hits ?? 0) + 1;
      await tx.execute(sql`
        insert into auth_throttle (firm_id, bucket, window_start, hits)
        values (app_current_firm_id(), ${bucket}, ${t0}, ${hits})
        on conflict (firm_id, bucket, window_start) do update set hits = ${hits}`);
      return hits <= 3;
    });
    expect(fulfilled(naive).filter(Boolean).length).toBeGreaterThan(3);

    const results = await race(10, T.firmId, (tx) =>
      hitLimit(tx, { limit: LIMITS.loginPerNumber, value: "+447700900555", now, secret: SECRET }),
    );
    expect(fulfilled(results)).toHaveLength(10);
    expect(fulfilled(results).filter((h) => h.allowed)).toHaveLength(3);
    expect(Math.max(...fulfilled(results).map((h) => h.hits))).toBe(10);
  });

  it("stores only HMACs: never the number or the IP", async () => {
    const T = await createTenant(su);
    const mobile = await mobileOf(su, T.workerId);
    await request(T, mobile, { ip: "203.0.113.77" });
    const { rows } = await su.query<{ bucket: string }>(
      "select bucket from auth_throttle where firm_id = $1 and bucket not like 'test:%'",
      [T.firmId],
    );
    expect(rows.map((r) => r.bucket.replace(/:[A-Za-z0-9_-]{32}$/, "")).sort()).toEqual([
      "login:ip",
      "login:mobile",
    ]);
    for (const r of rows) {
      expect(r.bucket).not.toContain(mobile.slice(3));
      expect(r.bucket).not.toContain("203.0.113.77");
    }
  });

  it("counts are per firm: Firm A's limit doesn't block the same number at Firm B", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const mobile = "+447700900554";
    for (let i = 0; i < 3; i++) await request(A, mobile);
    expect(await request(A, mobile)).toMatchObject({ status: "rate_limited" });
    expect(await request(B, mobile)).toEqual({ status: "sent" });
  });

  it("a limit is logged once per window, when first reached, without the number or IP", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const mobile = await mobileOf(su, T.workerId);
    for (let i = 0; i < 6; i++) await request(T, mobile, { ip: "198.51.100.9" });
    const limited = (await eventsFor(su, T.firmId, since)).filter(
      (e) => e.action === "auth.rate_limited",
    );
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({
      actor_type: "system",
      entity_type: "login_request",
      data: { limit: "login:mobile" },
    });
    expect(JSON.stringify(limited)).not.toContain("198.51.100.9");
  });
});
