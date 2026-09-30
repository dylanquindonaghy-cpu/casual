import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  purgeExpired,
  RETENTION,
  RETENTION_PURGE_QUEUE,
  RETENTION_PURGE_TICK_QUEUE,
  retentionPurgeTask,
  runRetentionPurgeTick,
} from "@/lib/gdpr/retention";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { appRolePool, superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The retention purge (docs/compliance.md "Retention defaults"): what has been kept long enough
// goes, nothing newer, only in the firm the job is for, with one event per run.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
});

afterAll(async () => {
  await app.end();
  await su.end();
});

const DAY = 24 * 60 * 60 * 1000;
const hash = () => randomBytes(32);
const smId = () => `SM${randomBytes(16).toString("hex")}`;

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

async function ids(table: string, firmId: string): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    `select id::text from ${table} where firm_id = $1 order by id`,
    [firmId],
  );
  return rows.map((r) => r.id).sort();
}

// Messages `days` old by the database's clock (app_purge_old_messages uses it).
const message = (t: Tenant, days: number, replyTo: string | null = null) =>
  one(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                           body, reply_to, created_at)
     values ($1, $2, 'whatsapp', $3, '+447700900111', '+447700900000', 'words', $4,
             now() - make_interval(days => $5))`,
    [t.firmId, replyTo ? "out" : "in", smId(), replyTo, days],
  );

async function aged(t: Tenant, now: Date) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const worker = t.workerId;
  const oldMessage = await message(t, RETENTION.messageDays + 1);
  const newReplyToOld = await message(t, RETENTION.messageDays - 1, oldMessage);
  const recentMessage = await message(t, RETENTION.messageDays - 1);
  const request = (days: number, payload: Record<string, unknown>) =>
    one(
      "insert into requests (firm_id, worker_id, type, payload, created_at) values ($1, $2, 'general', $3, $4)",
      [t.firmId, worker, JSON.stringify(payload), ago(days)],
    );
  const oldRequest = await request(RETENTION.requestNoteDays + 1, {
    note: "Old words",
    swapWith: "Cara Booker",
    via: "whatsapp",
  });
  const recentRequest = await request(RETENTION.requestNoteDays - 1, { note: "Recent words" });
  const throttle = (days: number) =>
    one("insert into auth_throttle (firm_id, bucket, window_start, hits) values ($1, $2, $3, 1)", [
      t.firmId,
      `test:${randomUUID()}`,
      ago(days),
    ]);
  const oldThrottle = await throttle(RETENTION.throttleDays + 0.1);
  const recentThrottle = await throttle(RETENTION.throttleDays - 0.9);
  const link = (expired: number) =>
    one(
      `insert into magic_links (firm_id, kind, worker_id, token_hash, request_id, expires_at)
       values ($1, 'worker', $2, $3, $4, $5)`,
      [t.firmId, worker, hash(), randomUUID(), ago(expired)],
    );
  const oldLink = await link(RETENTION.linkAndCodeDays + 0.1);
  const recentLink = await link(RETENTION.linkAndCodeDays - 0.9);
  const session = (expired: number, revoked: number | null = null) =>
    one(
      `insert into sessions (firm_id, kind, worker_id, token_hash, expires_at, rotated_at, revoked_at)
       values ($1, 'worker', $2, $3, $4, now(), $5)`,
      [t.firmId, worker, hash(), ago(expired), revoked === null ? null : ago(revoked)],
    );
  const expiredSession = await session(RETENTION.sessionDays + 0.1);
  const revokedSession = await session(-20, RETENTION.sessionDays + 0.1);
  const recentlyRevoked = await session(-20, RETENTION.sessionDays - 0.9);
  const oldCode = await one(
    "insert into otp_codes (firm_id, session_id, code_hash, expires_at, consumed_at) values ($1, $2, $3, $4, $4)",
    [t.firmId, recentlyRevoked, hash(), ago(RETENTION.linkAndCodeDays + 0.1)],
  );
  return {
    oldMessage,
    newReplyToOld,
    recentMessage,
    oldRequest,
    recentRequest,
    oldThrottle,
    recentThrottle,
    oldLink,
    recentLink,
    expiredSession,
    revokedSession,
    recentlyRevoked,
    oldCode,
  };
}

describe("the retention purge", () => {
  it("deletes what has been kept long enough, and nothing newer", async () => {
    const t = await createTenant(su);
    const now = new Date();
    const a = await aged(t, now);
    const counts = await withFirm(t.firmId, (tx) => purgeExpired(tx, now));
    expect(counts).toEqual({
      messages: 2,
      requestNotes: 1,
      throttle: 1,
      loginLinks: 1,
      sessions: 2,
      codes: 1,
    });

    expect(await ids("messages", t.firmId)).toEqual([a.recentMessage, t.rows.messages].sort());
    const { rows: reqs } = await su.query<{ id: string; payload: unknown }>(
      "select id::text, payload from requests where id = any($1::uuid[])",
      [[a.oldRequest, a.recentRequest]],
    );
    expect(Object.fromEntries(reqs.map((r) => [r.id, r.payload]))).toEqual({
      [a.oldRequest]: { via: "whatsapp" },
      [a.recentRequest]: { note: "Recent words" },
    });
    expect(await ids("auth_throttle", t.firmId)).toEqual(
      [a.recentThrottle, t.rows.auth_throttle].sort(),
    );
    expect(await ids("magic_links", t.firmId)).toEqual([a.recentLink, t.rows.magic_links].sort());
    expect(await ids("sessions", t.firmId)).toEqual(
      [a.recentlyRevoked, t.sessionId, t.spareSessionId].sort(),
    );
    expect(await ids("otp_codes", t.firmId)).toEqual([t.rows.otp_codes]);
  });

  it("logs every run (so the log shows it ran); a second run deletes nothing more", async () => {
    const t = await createTenant(su);
    const now = new Date();
    await aged(t, now);
    await withFirm(t.firmId, (tx) => purgeExpired(tx, now));
    const again = await withFirm(t.firmId, (tx) => purgeExpired(tx, now));
    expect(again).toEqual({
      messages: 0,
      requestNotes: 0,
      throttle: 0,
      loginLinks: 0,
      sessions: 0,
      codes: 0,
    });
    const { rows } = await su.query(
      `select actor_type, entity_type, entity_id::text, data from events
        where firm_id = $1 and action = 'retention.purged' order by id`,
      [t.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "system",
        entity_type: "firm",
        entity_id: t.firmId,
        data: { messages: 2, requestNotes: 1, throttle: 1, loginLinks: 1, sessions: 2, codes: 1 },
      },
      { actor_type: "system", entity_type: "firm", entity_id: t.firmId, data: again },
    ]);
  });

  it("touches only the firm it runs for", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    const now = new Date();
    await aged(t, now);
    const theirs = await aged(other, now);
    const before = {
      messages: await ids("messages", other.firmId),
      throttle: await ids("auth_throttle", other.firmId),
      links: await ids("magic_links", other.firmId),
      sessions: await ids("sessions", other.firmId),
      codes: await ids("otp_codes", other.firmId),
    };
    await withFirm(t.firmId, (tx) => purgeExpired(tx, now));
    expect({
      messages: await ids("messages", other.firmId),
      throttle: await ids("auth_throttle", other.firmId),
      links: await ids("magic_links", other.firmId),
      sessions: await ids("sessions", other.firmId),
      codes: await ids("otp_codes", other.firmId),
    }).toEqual(before);
    const { rows } = await su.query("select payload from requests where id = $1", [
      theirs.oldRequest,
    ]);
    expect(rows[0]?.payload).toEqual({
      note: "Old words",
      swapWith: "Cara Booker",
      via: "whatsapp",
    });
  });

  it("the messages' 90 days live in the database function, and no firm means an error", async () => {
    const { rows } = await su.query<{ def: string }>(
      "select pg_get_functiondef('app_purge_old_messages()'::regprocedure) as def",
    );
    expect(RETENTION.messageDays).toBe(90);
    expect(rows[0]?.def).toContain("interval '90 days'");
    const client = await app.connect();
    try {
      await expect(client.query("select app_purge_old_messages()")).rejects.toThrow(/needs a firm/);
    } finally {
      client.release();
    }
  });
});

describe("the two owner-run message deletions", () => {
  it.each(["app_purge_old_messages()", "app_erase_worker(uuid)"])(
    "%s runs as its owner, pinned search_path, only the app role may call it",
    async (fn) => {
      const { rows } = await su.query<{ definer: boolean; config: string[]; acl: string[] }>(
        `select prosecdef as definer, proconfig as config, proacl::text[] as acl
           from pg_proc where oid = $1::regprocedure`,
        [fn],
      );
      expect(rows[0]?.definer).toBe(true);
      expect(rows[0]?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
      expect(rows[0]?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
      expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
      expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_jobs="))).toBe(false);
    },
  );
});

describe("the nightly purge job", () => {
  it("the tick queues one job per firm per local date; the job purges that firm", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    const at = new Date("2026-11-03T03:30:00Z");
    const clock = { now: () => at };
    const tick = () =>
      runRetentionPurgeTick({
        listFirmIds: async () => [t.firmId, other.firmId],
        run: withFirm,
        clock,
      });
    expect(await tick()).toEqual({ queued: 2 });
    expect(await tick()).toEqual({ queued: 0 });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [RETENTION_PURGE_QUEUE, t.firmId],
    );
    expect(rows.map((r) => r.data)).toEqual([
      { firmId: t.firmId, idempotencyKey: "retention-purge:2026-11-03" },
    ]);
    const old = await message(t, RETENTION.messageDays + 1);
    await runFirmTask(
      retentionPurgeTask(() => ({ now: () => new Date() })),
      { id: "job", data: rows[0]?.data ?? {} },
      withFirm,
    );
    expect(await ids("messages", t.firmId)).not.toContain(old);
    const { rows: logged } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and action = 'retention.purged'",
      [t.firmId],
    );
    expect(logged[0]).toEqual({ n: 1 });
  });

  it("the worker works both queues, and the tick is scheduled for 03:30 London", async () => {
    expect(QUEUES.find((q) => q.name === RETENTION_PURGE_QUEUE)?.options?.policy).toBe("standard");
    expect(QUEUES.find((q) => q.name === RETENTION_PURGE_TICK_QUEUE)).toBeDefined();
    const worked: string[] = [];
    const scheduled: unknown[][] = [];
    const boss = {
      createQueue: async () => undefined,
      work: async (name: string) => {
        worked.push(name);
        return "id";
      },
      schedule: async (...args: unknown[]) => {
        scheduled.push(args);
      },
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(worked).toEqual(
      expect.arrayContaining([RETENTION_PURGE_QUEUE, RETENTION_PURGE_TICK_QUEUE]),
    );
    expect(scheduled).toContainEqual([
      RETENTION_PURGE_TICK_QUEUE,
      "30 3 * * *",
      null,
      { tz: "Europe/London" },
    ]);
  });
});
