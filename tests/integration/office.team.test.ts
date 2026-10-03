import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeOfficeLoginLink, currentOfficeUser } from "@/lib/auth/office-login";
import { sendPortalLink } from "@/lib/auth/send-portal-link";
import { createSession, findSession, rotateSession } from "@/lib/auth/sessions";
import { createWithFirm, withFirm, type WithFirm } from "@/lib/db/scoped";
import type { OutboundMessage } from "@/lib/messaging";
import {
  changeAccessFromOffice,
  changeOfficeAccess,
  type OfficeAccessChange,
} from "@/lib/office/team";
import { upsertWorker } from "@/lib/roster/workers";
import { captureTransport } from "../helpers/auth";
import { superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Taking office access away (audit M21, L80): the office team page's changes and the command
// line's, through src/lib/office/team.ts. Turning access off ends every session and unused login
// link at once; turning it back on revives nothing; a role is read again at the next request; the
// firm always keeps an active admin; every change is logged, by whom, with ids and counts only.
// Then the same for a worker whose status changes (an import or the rota sheet). Real database,
// app role, fixed clock, nothing sent anywhere.

let su: Pool;
beforeAll(() => {
  su = superuserPool();
});
afterAll(async () => {
  await su.end();
});

const NOW = new Date("2026-10-01T12:00:00.000Z");
const clock = { now: () => NOW };
let ipCounter = 0;
const freshIp = () => `10.8.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

async function addOffice(T: Tenant, role: "admin" | "resourcer" | "payroll", name = "Sam Rota") {
  const { rows } = await su.query<{ id: string }>(
    `insert into office_users (firm_id, email, name, role) values ($1, $2, $3, $4) returning id::text`,
    [T.firmId, `${role}${randomUUID().slice(0, 8)}@example.com`, name, role],
  );
  return rows[0]?.id ?? "";
}

const emailOf = async (id: string) =>
  (await su.query<{ email: string }>("select email from office_users where id = $1", [id])).rows[0]
    ?.email ?? "";

// A logged-in session for an office user: its token.
const loggedIn = async (T: Tenant, officeUserId: string) =>
  (
    await withFirm(T.firmId, (tx) =>
      createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
    )
  ).token;

// A login link emailed to them and not used yet: its token.
async function unusedLink(T: Tenant, officeUserId: string) {
  const { transport, sent } = captureTransport();
  await sendPortalLink(
    {
      firmId: T.firmId,
      idempotencyKey: randomUUID(),
      purpose: "office_login",
      subjectId: officeUserId,
    },
    withFirm,
    { transport, clock, baseDomain: "localhost:3000" },
  );
  const email = sent[0] as Extract<OutboundMessage, { channel: "email" }> | undefined;
  return /\/office\/l#([A-Za-z0-9_-]{43})\b/.exec(email?.body ?? "")?.[1] ?? "";
}

const ctx = (T: Tenant) => ({ firm: { id: T.firmId }, clientIp: freshIp(), clock });
const isIn = async (T: Tenant, token: string) =>
  (await currentOfficeUser(ctx(T), token))?.officeUser ?? null;

// An admin's change on the office team page.
const byAdmin = (T: Tenant, adminId: string, personId: string, change: OfficeAccessChange) =>
  changeAccessFromOffice(
    { firm: { id: T.firmId }, officeUserId: adminId, run: withFirm, clock },
    personId,
    change,
  );

async function teamEvents(firmId: string) {
  const { rows } = await su.query<{
    action: string;
    actor_type: string;
    actor_id: string | null;
    entity_id: string;
    data: Record<string, unknown>;
  }>(
    `select action, actor_type, actor_id::text, entity_id::text, data from events
      where firm_id = $1 and action like 'office_user.%' and action <> 'office_user.added'
      order by id`,
    [firmId],
  );
  return rows;
}

describe("turning office access off and back on", () => {
  it("off: logged out everywhere at once and every unused link spent; back on: nothing old revives", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const laptop = await loggedIn(T, sam);
    const phone = await loggedIn(T, sam);
    const link = await unusedLink(T, sam);
    expect(await isIn(T, laptop)).toMatchObject({ id: sam, role: "resourcer" });

    expect(await byAdmin(T, T.officeUserId, sam, { kind: "disable" })).toEqual({
      status: "done",
      change: "disable",
      name: "Sam Rota",
      role: "resourcer",
      sessionsEnded: 2,
    });
    // Out now, not at their next page: the sessions themselves are ended.
    const { rows: left } = await su.query(
      "select 1 from sessions where office_user_id = $1 and revoked_at is null",
      [sam],
    );
    expect(left).toHaveLength(0);
    expect(await isIn(T, laptop)).toBeNull();
    expect(await isIn(T, phone)).toBeNull();
    expect(await consumeOfficeLoginLink(ctx(T), link)).toEqual({ status: "rejected" });

    expect(await byAdmin(T, T.officeUserId, sam, { kind: "enable" })).toEqual({
      status: "done",
      change: "enable",
      name: "Sam Rota",
      role: "resourcer",
      sessionsEnded: 0,
    });
    // Back on: the old sessions and the old link stay dead. A new link works.
    expect(await isIn(T, laptop)).toBeNull();
    expect(await isIn(T, phone)).toBeNull();
    expect(await consumeOfficeLoginLink(ctx(T), link)).toEqual({ status: "rejected" });
    expect(await consumeOfficeLoginLink(ctx(T), await unusedLink(T, sam))).toMatchObject({
      status: "ok",
      officeUserId: sam,
    });

    // Logged, by the admin, with ids and counts only.
    const events = await teamEvents(T.firmId);
    expect(events).toEqual([
      {
        action: "office_user.disabled",
        actor_type: "office",
        actor_id: T.officeUserId,
        entity_id: sam,
        data: { officeUserId: sam, role: "resourcer", sessionsEnded: 2, linksSpent: 1 },
      },
      {
        action: "office_user.enabled",
        actor_type: "office",
        actor_id: T.officeUserId,
        entity_id: sam,
        data: { officeUserId: sam, role: "resourcer", sessionsEnded: 0, linksSpent: 0 },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("Sam");
    expect(JSON.stringify(events)).not.toContain(await emailOf(sam));
  });

  it("access turned off some other way (before this existed): turning it back on ends what was left", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "payroll");
    const old = await loggedIn(T, sam);
    // A link from before (or one made while access was being turned off).
    const link = await unusedLink(T, sam);
    await su.query("update office_users set status = 'disabled' where id = $1", [sam]);
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "enable" })).toMatchObject({
      status: "done",
      sessionsEnded: 1,
    });
    expect(await isIn(T, old)).toBeNull();
    expect(await consumeOfficeLoginLink(ctx(T), link)).toEqual({ status: "rejected" });
    expect((await teamEvents(T.firmId)).map((e) => e.data)).toEqual([
      { officeUserId: sam, role: "payroll", sessionsEnded: 1, linksSpent: 1 },
    ]);
  });

  it("a session's previous token, still inside its 60 seconds after a renewal, is ended too", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const before = await loggedIn(T, sam);
    // Renewed a day later: the old token still works for 60 seconds (requests already in flight).
    const later = new Date(NOW.getTime() + 86_400_000);
    const renewed = await withFirm(T.firmId, async (tx) => {
      const session = await findSession(tx, { kind: "office", token: before, now: later });
      return session ? rotateSession(tx, { session, now: later }) : null;
    });
    expect(renewed).not.toBeNull();
    const at = (token: string) =>
      withFirm(T.firmId, (tx) => findSession(tx, { kind: "office", token, now: later }));
    const current = await at(renewed?.token ?? "");
    expect(await at(before)).not.toBeNull();
    await byAdmin(T, T.officeUserId, sam, { kind: "disable" });
    expect(await at(before)).toBeNull();
    expect(await at(renewed?.token ?? "")).toBeNull();
    // A renewal that read the session just before it was ended doesn't bring it back.
    if (!current) throw new Error("the renewed session wasn't live before access was turned off");
    const again = await withFirm(T.firmId, (tx) =>
      rotateSession(tx, { session: current, now: later }),
    );
    expect(again).toBeNull();
  });

  it("a role change applies from their next request; their session carries on", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const token = await loggedIn(T, sam);
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "role", role: "payroll" })).toEqual({
      status: "done",
      change: "role",
      name: "Sam Rota",
      role: "payroll",
      sessionsEnded: 0,
    });
    expect(await isIn(T, token)).toMatchObject({ id: sam, role: "payroll" });
    expect((await teamEvents(T.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["office_user.role_changed", { officeUserId: sam, from: "resourcer", to: "payroll" }],
    ]);
  });

  it("log out on every device: sessions and links ended, access kept; nobody logged in: nothing logged", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const token = await loggedIn(T, sam);
    await unusedLink(T, sam);
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "sign_out" })).toMatchObject({
      status: "done",
      change: "sign_out",
      sessionsEnded: 1,
    });
    expect(await isIn(T, token)).toBeNull();
    const { rows } = await su.query<{ status: string }>(
      "select status from office_users where id = $1",
      [sam],
    );
    expect(rows[0]?.status).toBe("active");
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "sign_out" })).toMatchObject({
      status: "unchanged",
      change: "sign_out",
    });
    expect((await teamEvents(T.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["office_user.signed_out", { officeUserId: sam, sessionsEnded: 1, linksSpent: 1 }],
    ]);
  });

  it("a change that changes nothing says so and logs nothing", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "enable" })).toMatchObject({
      status: "unchanged",
      change: "enable",
    });
    expect(
      await byAdmin(T, T.officeUserId, sam, { kind: "role", role: "resourcer" }),
    ).toMatchObject({ status: "unchanged", change: "role", role: "resourcer" });
    await byAdmin(T, T.officeUserId, sam, { kind: "disable" });
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "disable" })).toMatchObject({
      status: "unchanged",
      change: "disable",
    });
    expect((await teamEvents(T.firmId)).map((e) => e.action)).toEqual(["office_user.disabled"]);
  });
});

describe("a login finishing at the same moment", () => {
  it.each(["disable", "sign_out"] as const)(
    "%s: no deadlock, and the session that login makes is ended too",
    async (kind) => {
      const T = await createTenant(su);
      const sam = await addOffice(T, "resourcer");
      await unusedLink(T, sam);
      const { rows: links } = await su.query<{ id: string }>(
        "select id::text from magic_links where office_user_id = $1 and used_at is null",
        [sam],
      );
      // The login, as loginWithLinkOf runs it: the link spent (its row locked) ...
      const login = await su.connect();
      let changing: ReturnType<typeof byAdmin> | null = null;
      try {
        await login.query("begin");
        await login.query("update magic_links set used_at = $2 where id = $1", [links[0]?.id, NOW]);
        // ... while the admin makes the change: that reaches the same link and waits for the login.
        changing = byAdmin(T, T.officeUserId, sam, { kind });
        for (let i = 0; ; i += 1) {
          const { rows } = await su.query(
            `select 1 from pg_stat_activity
              where wait_event_type = 'Lock' and query like '%magic_links%' and pid <> pg_backend_pid()`,
          );
          if (rows.length > 0) break;
          if (i > 100) throw new Error("the change never reached the link");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        // ... then the login makes its session: its key check on the person mustn't wait for the
        // change (which is waiting for it).
        await login.query(
          `insert into sessions (firm_id, kind, office_user_id, token_hash, expires_at, rotated_at)
           values ($1, 'office', $2, $3, $4, $5)`,
          [T.firmId, sam, randomBytes(32), new Date(NOW.getTime() + 86_400_000), NOW],
        );
        await login.query("commit");
      } finally {
        // Never hand the pool a connection still inside a failed transaction.
        await login.query("rollback").catch(() => undefined);
        login.release();
      }
      // The change went on after the login and ended the session it made.
      expect(await changing).toMatchObject({ status: "done", change: kind, sessionsEnded: 1 });
      const { rows: live } = await su.query<{ n: number }>(
        "select count(*)::int as n from sessions where office_user_id = $1 and revoked_at is null",
        [sam],
      );
      expect(live[0]?.n).toBe(0);
    },
  );
});

describe("only live sessions and links count", () => {
  it("someone whose session and link have both run out: not logged in anywhere", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    await loggedIn(T, sam);
    await unusedLink(T, sam);
    await su.query("update sessions set expires_at = $2 where office_user_id = $1", [
      sam,
      new Date(NOW.getTime() - 1000),
    ]);
    await su.query("update magic_links set expires_at = $2 where office_user_id = $1", [
      sam,
      new Date(NOW.getTime() - 1000),
    ]);
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "sign_out" })).toMatchObject({
      status: "unchanged",
      change: "sign_out",
    });
    expect(await byAdmin(T, T.officeUserId, sam, { kind: "disable" })).toMatchObject({
      status: "done",
      sessionsEnded: 0,
    });
    expect((await teamEvents(T.firmId)).map((e) => e.data)).toEqual([
      { officeUserId: sam, role: "resourcer", sessionsEnded: 0, linksSpent: 0 },
    ]);
  });
});

describe("who may change access, and the firm's last admin", () => {
  it("only an active admin of this firm, never their own; another firm's person is not found", async () => {
    const T = await createTenant(su);
    const B = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const pat = await addOffice(T, "payroll");
    const former = await addOffice(T, "admin");
    await su.query("update office_users set status = 'disabled' where id = $1", [former]);
    expect(await byAdmin(T, sam, pat, { kind: "disable" })).toEqual({ status: "not_allowed" });
    expect(await byAdmin(T, former, pat, { kind: "disable" })).toEqual({ status: "not_allowed" });
    expect(await byAdmin(T, T.officeUserId, T.officeUserId, { kind: "sign_out" })).toEqual({
      status: "self",
    });
    // Firm B's admin with firm A's person: not found, and A's person untouched.
    expect(await byAdmin(B, B.officeUserId, pat, { kind: "disable" })).toEqual({
      status: "not_found",
    });
    expect(await byAdmin(T, T.officeUserId, randomUUID(), { kind: "disable" })).toEqual({
      status: "not_found",
    });
    const { rows } = await su.query<{ status: string }>(
      "select status from office_users where id = $1",
      [pat],
    );
    expect(rows[0]?.status).toBe("active");
    expect(await teamEvents(T.firmId)).toEqual([]);
    expect(await teamEvents(B.firmId)).toEqual([]);
  });

  it("the firm's only active admin can't be turned off or made another role", async () => {
    const T = await createTenant(su);
    const system = { type: "system" } as const;
    const only = { email: await emailOf(T.officeUserId) };
    const change = (change: OfficeAccessChange) =>
      changeOfficeAccess(withFirm, T.firmId, { person: only, change, by: system }, { clock });
    expect(await change({ kind: "disable" })).toEqual({
      status: "last_admin",
      name: "Test Office",
    });
    expect(await change({ kind: "role", role: "resourcer" })).toEqual({
      status: "last_admin",
      name: "Test Office",
    });
    // An admin whose access is off doesn't count; one who can log in does.
    const second = await addOffice(T, "admin", "Ann Admin");
    await su.query("update office_users set status = 'disabled' where id = $1", [second]);
    expect(await change({ kind: "disable" })).toMatchObject({ status: "last_admin" });
    await su.query("update office_users set status = 'active' where id = $1", [second]);
    expect(await change({ kind: "role", role: "resourcer" })).toMatchObject({
      status: "done",
      role: "resourcer",
    });
    expect(await change({ kind: "role", role: "admin" })).toMatchObject({ status: "done" });
    expect(await change({ kind: "disable" })).toMatchObject({ status: "done" });
    // And now Ann is the only one.
    expect(await byAdmin(T, second, T.officeUserId, { kind: "enable" })).toMatchObject({
      status: "done",
    });
  });

  it("two admins turning each other off at the same moment: one wins, and the firm keeps an admin", async () => {
    const T = await createTenant(su);
    const ann = await addOffice(T, "admin", "Ann Admin");
    const pool = new Pool({ connectionString: urls.app, max: 2 });
    try {
      const run = createWithFirm(pool);
      // Both transactions open and wait at a barrier, then each makes its change at once.
      let arrived = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const timeout = setTimeout(release, 10_000);
      const at = (by: string, person: string) =>
        run(T.firmId, async (tx) => {
          await tx.execute(sql`select 1`);
          arrived += 1;
          if (arrived === 2) release();
          await gate;
          const inTx: WithFirm = (_firmId, fn) => fn(tx);
          return changeOfficeAccess(
            inTx,
            T.firmId,
            { person: { id: person }, change: { kind: "disable" }, by: { type: "office", id: by } },
            { clock },
          );
        });
      const results = await Promise.all([at(T.officeUserId, ann), at(ann, T.officeUserId)]);
      clearTimeout(timeout);
      expect(results.map((r) => r.status).sort()).toEqual(["done", "not_allowed"]);
    } finally {
      await pool.end();
    }
    const { rows } = await su.query<{ n: number }>(
      "select count(*)::int as n from office_users where firm_id = $1 and role = 'admin' and status = 'active'",
      [T.firmId],
    );
    expect(rows[0]?.n).toBe(1);
    expect((await teamEvents(T.firmId)).map((e) => e.action)).toEqual(["office_user.disabled"]);
  });
});

describe("the command line's change (changeOfficeAccess by email, as firm:office-user calls it)", () => {
  it("finds the person by email (any case and spacing), changes them, and logs it as the system", async () => {
    const T = await createTenant(su);
    const sam = await addOffice(T, "resourcer");
    const token = await loggedIn(T, sam);
    const email = `  ${(await emailOf(sam)).toUpperCase()} `;
    const run = (change: OfficeAccessChange, person: { email: string } = { email }) =>
      changeOfficeAccess(withFirm, T.firmId, { person, change, by: { type: "system" } }, { clock });
    expect(await run({ kind: "disable" })).toMatchObject({ status: "done", sessionsEnded: 1 });
    expect(await isIn(T, token)).toBeNull();
    expect(await run({ kind: "role", role: "payroll" })).toMatchObject({
      status: "done",
      role: "payroll",
    });
    expect(await run({ kind: "enable" }, { email: "nobody@example.com" })).toEqual({
      status: "not_found",
    });
    expect(await run({ kind: "enable" }, { email: "not an email" })).toEqual({
      status: "not_found",
    });
    const events = await teamEvents(T.firmId);
    expect(events.map((e) => [e.action, e.actor_type, e.actor_id])).toEqual([
      ["office_user.disabled", "system", null],
      ["office_user.role_changed", "system", null],
    ]);
  });
});

describe("a worker whose status changes (an import or the rota sheet) is logged out everywhere", () => {
  it("made inactive: sessions and unused links ended; made active again: nothing old revives", async () => {
    const T = await createTenant(su);
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [T.workerId],
    );
    const mobile = rows[0]?.mobile ?? "";
    const token = (
      await withFirm(T.firmId, (tx) =>
        createSession(tx, { kind: "worker", subjectId: T.workerId, now: NOW }),
      )
    ).token;
    const from = { source: "csv" as const, actor: { type: "system" as const }, now: NOW };
    const person = (status: "active" | "inactive") => ({
      firstName: "Test",
      lastName: "Worker",
      mobileE164: mobile,
      status,
    });
    const stillIn = () =>
      withFirm(T.firmId, (tx) => findSession(tx, { kind: "worker", token, now: NOW }));
    expect(await stillIn()).not.toBeNull();
    const open = async () =>
      (
        await su.query(
          `select (select count(*)::int from sessions where worker_id = $1 and revoked_at is null) as sessions,
                  (select count(*)::int from magic_links where worker_id = $1 and used_at is null) as links`,
          [T.workerId],
        )
      ).rows[0];
    // The fixture's session and link, and this one.
    expect(await open()).toEqual({ sessions: 2, links: 1 });

    await withFirm(T.firmId, (tx) => upsertWorker(tx, person("inactive"), from));
    expect(await open()).toEqual({ sessions: 0, links: 0 });

    await withFirm(T.firmId, (tx) => upsertWorker(tx, person("active"), from));
    expect(await stillIn()).toBeNull();
    const { rows: logged } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'worker.updated' order by id",
      [T.firmId],
    );
    expect(logged.map((e) => e.data)).toEqual([
      expect.objectContaining({ fields: ["status"], sessionsRevoked: 2, linksSpent: 1 }),
      expect.objectContaining({ fields: ["status"] }),
    ]);
  });
});
