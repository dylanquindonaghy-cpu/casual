import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DAY, HOUR } from "@/lib/auth/clock";
import {
  createSession,
  endSession,
  findSession,
  rotateSession,
  SESSION_LIFETIME_MS,
} from "@/lib/auth/sessions";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { sessions } from "@/lib/db/schema";
import { currentWorker, logoutWorker, refreshWorkerSession } from "@/lib/auth/worker-login";
import { withFirm } from "@/lib/db/scoped";
import { eventMark, eventsFor } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { fulfilled, race } from "../helpers/race";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Worker sessions: 30 days from login, token replaced daily with a 60-second overlap, gone at
// logout, and only ever valid for an active worker of the firm that issued them.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

const t0 = new Date("2026-10-01T08:00:00.000Z");
const at = (ms: number) => ({ now: () => new Date(t0.getTime() + ms) });

async function login(T: Tenant, kind: "worker" | "office" = "worker") {
  return withFirm(T.firmId, (tx) =>
    createSession(tx, {
      kind,
      subjectId: kind === "worker" ? T.workerId : T.officeUserId,
      now: t0,
    }),
  );
}
const lookup = (T: Tenant, token: string, ms: number) =>
  currentWorker({ firm: { id: T.firmId }, clock: at(ms) }, token);

describe("lifetime", () => {
  it("lasts exactly 30 days from login, however much it's used", async () => {
    const T = await createTenant(su);
    const s = await login(T);
    expect(s.expiresAt.getTime() - t0.getTime()).toBe(30 * DAY);
    expect(SESSION_LIFETIME_MS).toBe(30 * DAY);
    expect((await lookup(T, s.token, 30 * DAY - 1))?.worker.id).toBe(T.workerId);
    expect(await lookup(T, s.token, 30 * DAY)).toBeNull();
  });

  it("the cookie's token is stored only as its sha256", async () => {
    const T = await createTenant(su);
    const s = await login(T);
    const { rows } = await su.query<{ hash: Buffer }>(
      "select token_hash as hash from sessions where id = $1",
      [s.id],
    );
    expect(rows[0]?.hash.toString("hex")).toBe(createHash("sha256").update(s.token).digest("hex"));
  });
});

describe("daily token rotation", () => {
  it("not before 24 hours; then a new token, and the old one works for 60 more seconds only", async () => {
    const T = await createTenant(su);
    const s = await login(T);
    const ctx = (ms: number) => ({ firm: { id: T.firmId }, clock: at(ms) });
    expect(await refreshWorkerSession(ctx(24 * HOUR - 1), s.token)).toBeNull();

    const since = await eventMark(su);
    const fresh = await refreshWorkerSession(ctx(24 * HOUR), s.token);
    expect(fresh?.token).toBeTruthy();
    expect(fresh?.token).not.toBe(s.token);
    expect(fresh?.expiresAt).toEqual(s.expiresAt); // still 30 days from login

    expect((await lookup(T, fresh?.token ?? "", 24 * HOUR))?.worker.id).toBe(T.workerId);
    expect((await lookup(T, s.token, 24 * HOUR + 59_999))?.worker.id).toBe(T.workerId);
    expect(await lookup(T, s.token, 24 * HOUR + 60_000)).toBeNull();
    expect((await eventsFor(su, T.firmId, since)).map((e) => e.action)).toEqual([
      "auth.session_rotated",
    ]);
  });

  it("two requests rotating at the same moment: only one wins (control: an unconditional update lets both)", async () => {
    const T = await createTenant(su);
    const now = new Date(t0.getTime() + 25 * HOUR);

    const naiveSession = await login(T);
    const naive = await race(2, T.firmId, async (tx) => {
      const s = await findSession(tx, { kind: "worker", token: naiveSession.token, now });
      if (!s) return null;
      const updated = await tx
        .update(sessions)
        .set({ tokenHash: hashToken(newToken()), rotatedAt: now })
        .where(eq(sessions.id, s.id))
        .returning({ id: sessions.id });
      return updated[0] ?? null;
    });
    expect(fulfilled(naive).filter(Boolean)).toHaveLength(2);

    const real = await login(T);
    const results = await race(2, T.firmId, async (tx) => {
      const s = await findSession(tx, { kind: "worker", token: real.token, now });
      return s ? rotateSession(tx, { session: s, now }) : null;
    });
    expect(fulfilled(results)).toHaveLength(2);
    expect(fulfilled(results).filter(Boolean)).toHaveLength(1);
  });
});

describe("the end of a session", () => {
  it("logout ends it at once, and is logged", async () => {
    const T = await createTenant(su);
    const s = await login(T);
    const since = await eventMark(su);
    expect(await logoutWorker({ firm: { id: T.firmId }, clock: at(HOUR) }, s.token)).toBe(true);
    expect(await lookup(T, s.token, HOUR)).toBeNull();
    const events = await eventsFor(su, T.firmId, since);
    expect(events.map((e) => [e.action, e.actor_type, e.actor_id])).toEqual([
      ["auth.logout", "worker", T.workerId],
    ]);
  });

  it("two logouts at the same moment end it once and log it once (control: look-then-update ends it twice)", async () => {
    const T = await createTenant(su);
    const now = new Date(t0.getTime() + HOUR);

    const naiveSession = await login(T);
    const naive = await race(2, T.firmId, async (tx) => {
      const s = await findSession(tx, { kind: "worker", token: naiveSession.token, now });
      if (!s) return false;
      await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, s.id));
      return true;
    });
    expect(fulfilled(naive).filter(Boolean)).toHaveLength(2);

    const s = await login(T);
    const since = await eventMark(su);
    const results = await race(2, T.firmId, (tx) =>
      endSession(tx, { kind: "worker", token: s.token, now }),
    );
    expect(fulfilled(results).filter(Boolean)).toHaveLength(1);
    const logouts = (await eventsFor(su, T.firmId, since)).filter(
      (e) => e.action === "auth.logout",
    );
    expect(logouts).toHaveLength(1);
  });

  it("a worker blocked by the office is out at their next request", async () => {
    const T = await createTenant(su);
    const s = await login(T);
    expect(await lookup(T, s.token, HOUR)).not.toBeNull();
    await su.query("update workers set status = 'blocked' where id = $1", [T.workerId]);
    expect(await lookup(T, s.token, HOUR)).toBeNull();
  });
});

describe("where a session is valid", () => {
  it("only on the firm that issued it", async () => {
    const A = await createTenant(su);
    const B = await createTenant(su);
    const s = await login(A);
    expect(await lookup(B, s.token, HOUR)).toBeNull();
    expect(await lookup(A, s.token, HOUR)).not.toBeNull();
  });

  it("an office session is never a worker session", async () => {
    const T = await createTenant(su);
    const office = await login(T, "office");
    expect(await lookup(T, office.token, HOUR)).toBeNull();
  });
});
