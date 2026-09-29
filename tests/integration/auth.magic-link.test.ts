import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import {
  issueMagicLink,
  LINK_LIFETIME_MS,
  retireOtherLinks,
  spendMagicLink,
} from "@/lib/auth/magic-links";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { consumeWorkerLoginLink, loginWithLink } from "@/lib/auth/worker-login";
import { magicLinks } from "@/lib/db/schema";
import { withFirm } from "@/lib/db/scoped";
import { captureTransport, eventMark, eventsFor, movableClock, tokenFrom } from "../helpers/auth";
import { superuserPool } from "../helpers/db";
import { barrier, fulfilled, race } from "../helpers/race";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Login links: 15 minutes, single use, stored hashed, only for an active worker of this firm.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

// Sends a fresh link to the tenant's worker at time `at` and returns its token.
async function linkAt(T: Tenant, at: Date): Promise<string> {
  const { transport, sent } = captureTransport();
  const result = await withFirm(T.firmId, (tx) =>
    sendPortalLink(
      {
        firmId: T.firmId,
        idempotencyKey: randomUUID(),
        purpose: "worker_login",
        subjectId: T.workerId,
      },
      tx,
      { transport, clock: { now: () => at }, baseDomain: "localhost:3000" },
    ),
  );
  expect(result.sent).toBe(true);
  return tokenFrom(sent[0]);
}

async function linkIdOf(token: string): Promise<string | undefined> {
  const { rows } = await su.query<{ id: string }>(
    "select id::text from magic_links where token_hash = $1",
    [hashToken(token)],
  );
  return rows[0]?.id;
}

const consumeAt = (T: Tenant, token: string, at: Date) =>
  consumeWorkerLoginLink({ firm: { id: T.firmId }, clock: { now: () => at } }, token);

describe("expiry", () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await createTenant(su);
  });

  it("a link lasts exactly 15 minutes", async () => {
    const t0 = new Date("2026-10-01T09:00:00.000Z");
    const token = await linkAt(T, t0);
    const { rows } = await su.query("select expires_at from magic_links where token_hash = $1", [
      hashToken(token),
    ]);
    expect(new Date(rows[0]?.expires_at).getTime() - t0.getTime()).toBe(15 * MINUTE);
    expect(LINK_LIFETIME_MS).toBe(15 * MINUTE);
  });

  it("works 1 ms before it expires", async () => {
    const t0 = new Date("2026-10-01T10:00:00.000Z");
    const token = await linkAt(T, t0);
    expect((await consumeAt(T, token, new Date(t0.getTime() + 15 * MINUTE - 1))).status).toBe("ok");
  });

  it("is refused from the moment it expires, and the log says why", async () => {
    const t0 = new Date("2026-10-01T11:00:00.000Z");
    const token = await linkAt(T, t0);
    const since = await eventMark(su);
    expect(await consumeAt(T, token, new Date(t0.getTime() + 15 * MINUTE))).toEqual({
      status: "rejected",
    });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      {
        action: "auth.link_rejected",
        actor_type: "system",
        actor_id: null,
        entity_type: "magic_link",
        entity_id: await linkIdOf(token),
        data: { kind: "worker", reason: "expired" },
      },
    ]);
  });
});

describe("single use", () => {
  it("10 taps at the same moment: exactly one logs in (control: a read-then-write version lets several in)", async () => {
    const T = await createTenant(su);
    const now = new Date();

    // Canary: check-then-update, the bug this test exists to catch, lets more than one through.
    const naiveToken = await linkAt(T, now);
    const naive = await race(10, T.firmId, async (tx) => {
      const [link] = await tx
        .select({ id: magicLinks.id })
        .from(magicLinks)
        .where(and(eq(magicLinks.tokenHash, hashToken(naiveToken)), isNull(magicLinks.usedAt)));
      if (!link) return null;
      await tx.update(magicLinks).set({ usedAt: now }).where(eq(magicLinks.id, link.id));
      return link.id;
    });
    expect(fulfilled(naive).filter(Boolean).length).toBeGreaterThan(1);

    // The real thing: one conditional UPDATE.
    const token = await linkAt(T, now);
    const results = await race(10, T.firmId, (tx) =>
      spendMagicLink(tx, { kind: "worker", token, now }),
    );
    expect(fulfilled(results)).toHaveLength(10);
    expect(fulfilled(results).filter(Boolean)).toHaveLength(1);
  });

  it("10 taps of the whole login at once: one session, one auth.login, nine rejections logged as used", async () => {
    const T = await createTenant(su);
    const now = new Date("2026-10-01T12:00:00.000Z");
    const token = await linkAt(T, now);
    const sessionCount = async () =>
      (
        await su.query<{ n: number }>(
          "select count(*)::int as n from sessions where firm_id = $1",
          [T.firmId],
        )
      ).rows[0]?.n;
    const sessionsBefore = await sessionCount();
    const since = await eventMark(su);
    const results = await race(10, T.firmId, (tx) => loginWithLink(tx, { token, now }));
    const outcomes = fulfilled(results);
    expect(outcomes).toHaveLength(10);
    expect(outcomes.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(await sessionCount()).toBe((sessionsBefore ?? 0) + 1);

    const id = await linkIdOf(token);
    const events = await eventsFor(su, T.firmId, since);
    expect(events.filter((e) => e.action === "auth.login")).toEqual([
      expect.objectContaining({
        actor_type: "worker",
        actor_id: T.workerId,
        data: { kind: "worker", magicLinkId: id },
      }),
    ]);
    expect(events.filter((e) => e.action === "auth.link_rejected")).toEqual(
      Array.from({ length: 9 }, () => ({
        action: "auth.link_rejected",
        actor_type: "system",
        actor_id: null,
        entity_type: "magic_link",
        entity_id: id,
        data: { kind: "worker", reason: "used" },
      })),
    );
    expect(events).toHaveLength(10);
  });

  it("two of one worker's links used at the same moment both work, without a deadlock (control: the old retire deadlocks)", async () => {
    const T = await createTenant(su);
    const now = new Date();

    // Both transactions spend their own link first and only then retire the other links (a
    // second barrier forces that order; without it one login can finish before the other starts,
    // and nothing collides). Control: a plain UPDATE then waits on the row the other one holds,
    // both ways, and Postgres kills one of them (40P01).
    const naiveTokens = [await linkAt(T, now), await linkAt(T, now)];
    let n = 0;
    const bothSpentNaive = barrier(2);
    const naive = await race(2, T.firmId, async (tx) => {
      const token = naiveTokens[n++] ?? "";
      const used = await spendMagicLink(tx, { kind: "worker", token, now });
      await bothSpentNaive();
      await tx.execute(
        sql`update magic_links set used_at = ${now} where worker_id = ${T.workerId} and used_at is null`,
      );
      return used;
    });
    const deadlocked = naive.filter(
      (r) =>
        r.status === "rejected" &&
        /40P01|deadlock/.test(
          JSON.stringify(r.reason, Object.getOwnPropertyNames(r.reason)) +
            String((r.reason as { cause?: { code?: string } }).cause?.code),
        ),
    );
    expect(deadlocked).toHaveLength(1);

    // The real retire skips rows another login holds: with the same forced order, both work.
    const tokens = [await linkAt(T, now), await linkAt(T, now)];
    let i = 0;
    const bothSpent = barrier(2);
    const results = await race(2, T.firmId, async (tx) => {
      const used = await spendMagicLink(tx, { kind: "worker", token: tokens[i++] ?? "", now });
      await bothSpent();
      await retireOtherLinks(tx, { kind: "worker", subjectId: T.workerId, now });
      return used;
    });
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(fulfilled(results).filter(Boolean)).toHaveLength(2);

    // And the whole login, both at the same moment. Held there on purpose: without it one login
    // can finish, retiring the worker's other links, before the other spends its own, and then
    // that link is rightly refused (the next test). A separate connection holds both links'
    // rows until both logins are queued behind them, then lets them go together.
    const more = [await linkAt(T, now), await linkAt(T, now)];
    let k = 0;
    const holder = await su.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "select id from magic_links where worker_id = $1 and used_at is null for update",
        [T.workerId],
      );
      const running = race(2, T.firmId, (tx) => loginWithLink(tx, { token: more[k++] ?? "", now }));
      let queued = 0;
      for (let tries = 0; tries < 200 && queued < 2; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const { rows } = await su.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query like '%update magic_links ml set used_at%'`,
        );
        queued = rows[0]?.n ?? 0;
      }
      expect(queued).toBe(2);
      await holder.query("commit");
      const logins = await running;
      expect(fulfilled(logins).map((r) => r.status)).toEqual(["ok", "ok"]);
    } finally {
      holder.release();
    }
  });

  it("logging in retires the worker's other unused links", async () => {
    const T = await createTenant(su);
    const now = new Date();
    const first = await linkAt(T, now);
    const second = await linkAt(T, now);
    expect((await consumeAt(T, second, now)).status).toBe("ok");
    expect(await consumeAt(T, first, now)).toEqual({ status: "rejected" });
  });
});

describe("who a link works for", () => {
  it("not for a worker who has since been blocked", async () => {
    const T = await createTenant(su);
    const now = new Date();
    const token = await linkAt(T, now);
    await su.query("update workers set status = 'blocked' where id = $1", [T.workerId]);
    const since = await eventMark(su);
    expect(await consumeAt(T, token, now)).toEqual({ status: "rejected" });
    expect((await eventsFor(su, T.firmId, since)).map((e) => [e.action, e.data])).toEqual([
      ["auth.link_rejected", { kind: "worker", reason: "inactive" }],
    ]);
  });

  it("an office link can't log anyone in as a worker", async () => {
    const T = await createTenant(su);
    const token = newToken();
    await su.query(
      `insert into magic_links (firm_id, kind, office_user_id, token_hash, request_id, expires_at)
       values ($1, 'office', $2, $3, $4, now() + interval '15 minutes')`,
      [T.firmId, T.officeUserId, hashToken(token), randomUUID()],
    );
    const since = await eventMark(su);
    expect(await consumeAt(T, token, new Date())).toEqual({ status: "rejected" });
    expect(await eventsFor(su, T.firmId, since)).toEqual([
      {
        action: "auth.link_rejected",
        actor_type: "system",
        actor_id: null,
        entity_type: "magic_link",
        entity_id: await linkIdOf(token),
        data: { kind: "worker", reason: "wrong_kind" },
      },
    ]);
    // The office link itself is untouched.
    const { rows } = await su.query("select used_at from magic_links where token_hash = $1", [
      hashToken(token),
    ]);
    expect(rows[0]?.used_at).toBeNull();
  });

  it("garbage in the link is refused without an error", async () => {
    const T = await createTenant(su);
    for (const junk of ["", "x", "' or 1=1 --", "a".repeat(43), "é".repeat(43)]) {
      expect(await consumeAt(T, junk, new Date())).toEqual({ status: "rejected" });
    }
  });
});

describe("retrying the send job", () => {
  it("after the link went out: does nothing, sends nothing", async () => {
    const T = await createTenant(su);
    const payload = {
      firmId: T.firmId,
      idempotencyKey: randomUUID(),
      purpose: "worker_login" as const,
      subjectId: T.workerId,
    };
    const { transport, sent } = captureTransport();
    const deps = { transport, clock: movableClock().clock, baseDomain: "localhost:3000" };
    expect((await withFirm(T.firmId, (tx) => sendPortalLink(payload, tx, deps))).sent).toBe(true);
    expect(await withFirm(T.firmId, (tx) => sendPortalLink(payload, tx, deps))).toEqual({
      sent: false,
      reason: "already_sent",
    });
    expect(sent).toHaveLength(1);
  });

  it("before it went out: the undelivered token is replaced, so only the delivered one works", async () => {
    const T = await createTenant(su);
    const requestId = randomUUID();
    const now = new Date();
    const lost = await withFirm(T.firmId, (tx) =>
      issueMagicLink(tx, { kind: "worker", subjectId: T.workerId, requestId, now }),
    );
    const { transport, sent } = captureTransport();
    await withFirm(T.firmId, (tx) =>
      sendPortalLink(
        {
          firmId: T.firmId,
          idempotencyKey: requestId,
          purpose: "worker_login",
          subjectId: T.workerId,
        },
        tx,
        { transport, clock: { now: () => now }, baseDomain: "localhost:3000" },
      ),
    );
    expect(sent).toHaveLength(1);
    expect(await consumeAt(T, lost?.token ?? "", now)).toEqual({ status: "rejected" });
    expect((await consumeAt(T, tokenFrom(sent[0]), now)).status).toBe("ok");
  });
});
