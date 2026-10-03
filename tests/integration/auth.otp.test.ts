import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createSendLoginCodeTask, sendLoginCode } from "@/lib/auth/send-login-code";
import { createSession, findSession } from "@/lib/auth/sessions";
import {
  checkCode,
  hasLiveCode,
  isSteppedUp,
  requestStepUpCode,
  verifyStepUpCode,
} from "@/lib/auth/step-up";
import { OTP_MAX_ATTEMPTS } from "@/lib/db/schema";
import { withFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { captureTransport, eventMark, eventsFor, mobileOf, quietLogger } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { fulfilled, race } from "../helpers/race";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The pay pages' step-up: a 6-digit code by WhatsApp, 10 minutes, 5 tries, 30 minutes of access.

const SECRET = "test-only-secret-not-for-any-real-use-0123";
const t0 = new Date("2026-10-01T08:00:00.000Z");
const at = (ms: number) => ({ now: () => new Date(t0.getTime() + ms) });

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

async function loggedIn(T: Tenant) {
  return withFirm(T.firmId, (tx) =>
    createSession(tx, { kind: "worker", subjectId: T.workerId, now: t0 }),
  );
}

// Sends a code at `ms` (as the worker's job does) and returns it.
async function codeAt(T: Tenant, sessionId: string, ms: number, code = "123456") {
  const { transport, sent } = captureTransport();
  const result = await sendLoginCode(
    { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId },
    withFirm,
    {
      transport,
      clock: at(ms),
      secret: SECRET,
      newCode: () => code,
    },
  );
  expect(result.sent).toBe(true);
  return { code, message: sent[0] };
}

const verify = (T: Tenant, token: string, code: string, ms: number) =>
  verifyStepUpCode({ firm: { id: T.firmId }, clock: at(ms), secret: SECRET }, token, code);

describe("the code", () => {
  it("is 6 digits, goes to the worker's own number, signed by the firm, and is stored only as an HMAC", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const { transport, sent } = captureTransport();
    const job = createSendLoginCodeTask(() => ({ transport, clock: at(0), secret: SECRET }));
    const result = await runFirmTask(
      job,
      { id: "j", data: { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId: s.id } },
      undefined,
      quietLogger,
    );
    expect(result.status).toBe("completed");
    expect(JSON.stringify(result.output)).not.toMatch(/\b\d{6}\b/); // ids only in the job output
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(await mobileOf(su, T.workerId));
    const code = /code is (\d{6})\./.exec(sent[0]?.body ?? "")?.[1] ?? "";
    expect(code).toMatch(/^\d{6}$/);
    expect(sent[0]?.body).toMatch(/— Test Firm \S+ Shift Team$/);

    const { rows } = await su.query<{ hash: Buffer; expires_at: Date }>(
      "select code_hash as hash, expires_at from otp_codes where session_id = $1",
      [s.id],
    );
    expect(rows[0]?.hash.toString("hex")).toBe(
      createHmac("sha256", SECRET).update(`otp:${s.id}:${code}`).digest("hex"),
    );
    expect(new Date(rows[0]?.expires_at ?? 0).getTime() - t0.getTime()).toBe(10 * MINUTE);
  });

  it("works 1 ms before 10 minutes are up, and not at 10 minutes", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0, "111111");
    expect(await verify(T, s.token, "111111", 10 * MINUTE)).toEqual({ status: "expired" });
    await codeAt(T, s.id, 0, "222222");
    expect((await verify(T, s.token, "222222", 10 * MINUTE - 1)).status).toBe("ok");
  });

  it("works once", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    expect((await verify(T, s.token, "123456", MINUTE)).status).toBe("ok");
    expect(await verify(T, s.token, "123456", MINUTE)).toEqual({ status: "expired" });
  });

  it("asking again replaces the earlier code", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0, "111111");
    await codeAt(T, s.id, MINUTE, "222222");
    expect(await verify(T, s.token, "111111", 2 * MINUTE)).toMatchObject({ status: "wrong" });
    expect((await verify(T, s.token, "222222", 2 * MINUTE)).status).toBe("ok");
  });

  it("anything that isn't 6 digits is refused without using a try", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    for (const junk of ["", "12345", "1234567", "abcdef"]) {
      expect(await verify(T, s.token, junk, MINUTE)).toEqual({ status: "invalid_code" });
    }
    expect((await verify(T, s.token, "123 456", MINUTE)).status).toBe("ok");
  });
});

describe("tries", () => {
  it("5 tries: the count goes down, then the code stops working, even the right one", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    for (const left of [4, 3, 2, 1]) {
      expect(await verify(T, s.token, "000000", MINUTE)).toEqual({
        status: "wrong",
        attemptsLeft: left,
      });
    }
    expect(await verify(T, s.token, "000000", MINUTE)).toEqual({ status: "expired" });
    expect(await verify(T, s.token, "123456", MINUTE)).toEqual({ status: "expired" });
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });

  it("10 guesses at the same moment get 5 comparisons, no more (control: read-then-increment lets all 10 compare)", async () => {
    const T = await createTenant(su);
    const now = new Date(t0.getTime() + MINUTE);

    const naiveSession = await loggedIn(T);
    await codeAt(T, naiveSession.id, 0);
    const naive = await race(10, T.firmId, async (tx) => {
      const { rows } = await tx.execute<{ id: string; attempts: number }>(
        sql`select id, attempts from otp_codes where session_id = ${naiveSession.id} and consumed_at is null`,
      );
      const row = rows[0];
      if (!row || row.attempts >= 5) return false;
      await tx.execute(
        sql`update otp_codes set attempts = ${row.attempts + 1} where id = ${row.id}`,
      );
      return true; // this guess got compared
    });
    expect(fulfilled(naive).filter(Boolean).length).toBeGreaterThan(5);

    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    const since = await eventMark(su);
    const results = await race(10, T.firmId, async (tx) => {
      const session = await findSession(tx, { kind: "worker", token: s.token, now });
      if (!session) throw new Error("session not found");
      return checkCode(tx, { session, code: "000000", now, secret: SECRET });
    });
    // Every guess got an answer: 4 "wrong" (4, 3, 2, 1 tries left), then the 5th comparison
    // locked the code and the other 5 found no live code: 6 "expired".
    expect(fulfilled(results)).toHaveLength(10);
    const statuses = fulfilled(results).map((r) => r.status);
    expect(statuses.filter((x) => x === "wrong")).toHaveLength(4);
    expect(statuses.filter((x) => x === "expired")).toHaveLength(6);
    expect(
      fulfilled(results)
        .flatMap((r) => (r.status === "wrong" ? [r.attemptsLeft] : []))
        .sort(),
    ).toEqual([1, 2, 3, 4]);
    // Exactly 5 comparisons happened: one log entry each.
    const compared = (await eventsFor(su, T.firmId, since)).filter((e) =>
      ["auth.otp_failed", "auth.otp_locked"].includes(e.action),
    );
    expect(compared.map((e) => e.action).sort()).toEqual([
      "auth.otp_failed",
      "auth.otp_failed",
      "auth.otp_failed",
      "auth.otp_failed",
      "auth.otp_locked",
    ]);
    const { rows } = await su.query("select attempts from otp_codes where session_id = $1", [s.id]);
    expect(rows[0]).toEqual({ attempts: 5 });
  });
});

describe("what a correct code opens", () => {
  it("nothing after exactly 30 minutes", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    await verify(T, s.token, "123456", MINUTE);
    const lookup = (ms: number) =>
      withFirm(T.firmId, (tx) =>
        findSession(tx, { kind: "worker", token: s.token, now: new Date(t0.getTime() + ms) }),
      );
    const before = await lookup(31 * MINUTE - 1);
    const after = await lookup(31 * MINUTE);
    expect(before && isSteppedUp(before, new Date(t0.getTime() + 31 * MINUTE - 1))).toBe(true);
    expect(after && isSteppedUp(after, new Date(t0.getTime() + 31 * MINUTE))).toBe(false);
  });

  it("only the session that typed it, not the same worker's other sessions", async () => {
    const T = await createTenant(su);
    const phone = await loggedIn(T);
    const tablet = await loggedIn(T);
    await codeAt(T, phone.id, 0);
    await verify(T, phone.token, "123456", MINUTE);
    const now = new Date(t0.getTime() + 2 * MINUTE);
    const [p, t] = await withFirm(T.firmId, async (tx) => [
      await findSession(tx, { kind: "worker", token: phone.token, now }),
      await findSession(tx, { kind: "worker", token: tablet.token, now }),
    ]);
    expect(p && isSteppedUp(p, now)).toBe(true);
    expect(t && isSteppedUp(t, now)).toBe(false);
  });

  it("the pay pages for exactly 30 minutes", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0);
    const result = await verify(T, s.token, "123456", MINUTE);
    expect(result).toEqual({ status: "ok", steppedUpUntil: new Date(t0.getTime() + 31 * MINUTE) });
    const session = await withFirm(T.firmId, (tx) =>
      findSession(tx, { kind: "worker", token: s.token, now: new Date(t0.getTime() + MINUTE) }),
    );
    expect(session?.steppedUpUntil).toEqual(new Date(t0.getTime() + 31 * MINUTE));
  });

  it("only in the session it was sent to, and only on its own firm", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const s = await loggedIn(A);
    const other = await loggedIn(A);
    await codeAt(A, s.id, 0);
    expect(await verify(B, s.token, "123456", MINUTE)).toEqual({ status: "logged_out" });
    expect(await verify(A, other.token, "123456", MINUTE)).toEqual({ status: "expired" });
    expect((await verify(A, s.token, "123456", MINUTE)).status).toBe("ok");
  });
});

describe("asking for codes", () => {
  it("needs a live worker session", async () => {
    const T = await createTenant(su);
    expect(
      await requestStepUpCode({ firm: { id: T.firmId }, secret: SECRET }, "x".repeat(43)),
    ).toEqual({
      status: "logged_out",
    });
  });

  it("the 3-per-15-minutes limit is per worker, across all their sessions", async () => {
    const T = await createTenant(su);
    const one = await loggedIn(T);
    const two = await loggedIn(T);
    const ctx = { firm: { id: T.firmId }, clock: at(MINUTE), secret: SECRET };
    await requestStepUpCode(ctx, one.token);
    await requestStepUpCode(ctx, two.token);
    await requestStepUpCode(ctx, one.token);
    expect(await requestStepUpCode(ctx, two.token)).toMatchObject({ status: "rate_limited" });
  });

  it("and 10 a day, however they're spread", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const statuses: string[] = [];
    for (let i = 0; i < 11; i++) {
      // 20 minutes apart: never more than 3 in one 15-minute window. All on 1 October (UTC).
      const ctx = { firm: { id: T.firmId }, clock: at(i * 20 * MINUTE), secret: SECRET };
      statuses.push((await requestStepUpCode(ctx, s.token)).status);
    }
    expect(statuses.slice(0, 10).every((x) => x === "sent")).toBe(true);
    expect(statuses[10]).toBe("rate_limited");
  });

  it("3 codes per worker every 15 minutes, then 'too many tries'", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const ctx = { firm: { id: T.firmId }, clock: at(MINUTE), secret: SECRET };
    for (let i = 0; i < 3; i++)
      expect(await requestStepUpCode(ctx, s.token)).toEqual({ status: "sent" });
    expect(await requestStepUpCode(ctx, s.token)).toMatchObject({ status: "rate_limited" });
  });

  it("queues a job holding ids only", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await requestStepUpCode({ firm: { id: T.firmId }, clock: at(MINUTE), secret: SECRET }, s.token);
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      `select data from pgboss.job where name = 'send-login-code' and data ->> 'firmId' = $1`,
      [T.firmId],
    );
    expect(rows.map((r) => Object.keys(r.data).sort())).toEqual([
      ["firmId", "idempotencyKey", "sessionId"],
    ]);
  });
});

describe("the send job", () => {
  it.each([
    ["a logged-out session", "update sessions set revoked_at = now() where id = $1"],
    ["an expired session", "update sessions set expires_at = '2026-01-01' where id = $1"],
    [
      "a blocked worker",
      "update workers set status = 'blocked' where id = (select worker_id from sessions where id = $1)",
    ],
  ])("sends nothing to %s", async (_label, change) => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    await su.query(change, [s.id]);
    const { transport, sent } = captureTransport();
    const result = await sendLoginCode(
      { firmId: T.firmId, idempotencyKey: randomUUID(), sessionId: s.id },
      withFirm,
      {
        transport,
        clock: at(0),
        secret: SECRET,
      },
    );
    expect(result).toEqual({ sent: false, reason: "no_session" });
    expect(sent).toHaveLength(0);
  });
});

describe("the code field after a reload", () => {
  it("is offered while a sent code still works, and not once it stops", async () => {
    const T = await createTenant(su);
    const s = await loggedIn(T);
    const ctx = (ms: number) => ({ firm: { id: T.firmId }, clock: at(ms), secret: SECRET });
    const session = async (ms: number) => {
      const found = await withFirm(T.firmId, (tx) =>
        findSession(tx, { kind: "worker", token: s.token, now: new Date(t0.getTime() + ms) }),
      );
      if (!found) throw new Error("no session");
      return found;
    };
    expect(await hasLiveCode(ctx(0), await session(0))).toBe(false);
    await codeAt(T, s.id, 0);
    expect(await hasLiveCode(ctx(MINUTE), await session(MINUTE))).toBe(true);
    expect(await hasLiveCode(ctx(10 * MINUTE), await session(10 * MINUTE))).toBe(false);
  });
});

describe("the action log", () => {
  it("records request, send, each failure, the lock and success, never the code", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const s = await loggedIn(T);
    await requestStepUpCode({ firm: { id: T.firmId }, clock: at(0), secret: SECRET }, s.token);
    await codeAt(T, s.id, 0, "654321");
    await verify(T, s.token, "000000", MINUTE);
    await verify(T, s.token, "654321", MINUTE);
    const events = await eventsFor(su, T.firmId, since);
    expect(events.map((e) => e.action)).toEqual([
      "auth.otp_requested",
      "auth.otp_sent",
      "auth.otp_failed",
      "auth.otp_verified",
    ]);
    expect(events[2]?.data).toEqual({ attemptsLeft: 4 });
    expect(JSON.stringify(events)).not.toContain("654321");
  });

  it("records the lock once, and the request limit once, with no personal data", async () => {
    const T = await createTenant(su);
    const since = await eventMark(su);
    const s = await loggedIn(T);
    await codeAt(T, s.id, 0, "654321");
    for (let i = 0; i < 6; i++) await verify(T, s.token, "000000", MINUTE);
    const ctx = { firm: { id: T.firmId }, clock: at(2 * MINUTE), secret: SECRET };
    for (let i = 0; i < 5; i++) await requestStepUpCode(ctx, s.token);
    const events = await eventsFor(su, T.firmId, since);
    expect(events.filter((e) => e.action === "auth.otp_locked")).toHaveLength(1);
    expect(events.filter((e) => e.action === "auth.rate_limited")).toEqual([
      {
        action: "auth.rate_limited",
        actor_type: "system",
        actor_id: null,
        entity_type: "session",
        entity_id: null,
        data: { limit: "otp:worker" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("654321");
  });
});
