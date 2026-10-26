import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { syncAlert, type AlertTransport, type OpsAlert } from "@/lib/ops/alerts";
import {
  firmAlerts,
  OPS_ALERT_QUEUE,
  type OpsTickDeps,
  OPS_ALERTS_TICK_QUEUE,
  runOpsAlertsTick,
  sendOpsAlert,
} from "@/lib/ops/tick";
import { createBoss } from "@/worker/boss";
import { failedJobCounts, queueHealth, queueOpsAlert, registerJobs } from "@/worker/jobs";
import { HELLO_QUEUE } from "@/worker/jobs/hello";
import { QUEUES } from "@/worker/jobs/queues";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// The ops alerts on the real database (docs/api-and-jobs.md `ops-alerts-tick`): each firm's
// signals inside its own firm, failed jobs through pg-boss, and one alert per problem per hour.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let boss: PgBoss;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool();
  withFirm = createWithFirm(app);
  boss = createBoss(urls.jobs);
  await boss.start();
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await app.end();
  await su.end();
});

const MINUTE = 60_000;

// `n` events of one kind, `minutesAgo` before now, on the given channel.
async function events(
  t: Tenant,
  action: string,
  n: number,
  o: { minutesAgo?: number; channel?: string; code?: string } = {},
) {
  const at = new Date(Date.now() - (o.minutesAgo ?? 10) * MINUTE);
  const data = { channel: o.channel ?? "whatsapp", ...(o.code ? { code: o.code } : {}) };
  await su.query(
    `insert into events (firm_id, actor_type, action, entity_type, data, created_at)
     select $1, 'system', $2, 'offer', $3, $4 from generate_series(1, $5)`,
    [t.firmId, action, JSON.stringify(data), at, n],
  );
}

const alertsFor = (t: Tenant) => withFirm(t.firmId, (tx) => firmAlerts(tx, t.firmId, new Date()));

// The tick's queue and connection parts with nothing to say (P4.8).
const quiet: Pick<OpsTickDeps, "queueHealth" | "connectionWaits"> = {
  queueHealth: async () => ({ waiting: [], runningLong: [] }),
  connectionWaits: () => ({ slow: 0, timedOut: 0, poolMax: 15 }),
};

// `n` of a firm's `message.received` lines, `minutesAgo` before now, with this data (P4.8).
async function received(
  t: Tenant,
  n: number,
  data: Record<string, unknown>,
  o: { minutesAgo?: number } = {},
) {
  const at = new Date(Date.now() - (o.minutesAgo ?? 10) * MINUTE);
  await su.query(
    `insert into events (firm_id, actor_type, action, entity_type, data, created_at)
     select $1, 'system', 'message.received', 'message', $2, $3 from generate_series(1, $4)`,
    [t.firmId, JSON.stringify({ channel: "whatsapp", ...data }), at, n],
  );
}

// `n` more WhatsApps in to a firm's line, `minutesAgo` before now (each its own made-up id).
async function inbound(t: Tenant, n: number, o: { minutesAgo?: number } = {}) {
  const at = new Date(Date.now() - (o.minutesAgo ?? 10) * MINUTE);
  await su.query(
    `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, body, created_at)
     select $1, 'in', 'whatsapp', 'SMp48' || md5(random()::text || g::text), '+447700900321',
            '+447700900000', 'hello', $2
       from generate_series(1, $3) g`,
    [t.firmId, at, n],
  );
}

// `n` more offers from a firm (its fixture's shift and worker, waves from 2), `minutesAgo` before.
async function offers(t: Tenant, n: number, o: { minutesAgo?: number; fromWave?: number } = {}) {
  const at = new Date(Date.now() - (o.minutesAgo ?? 10) * MINUTE);
  await su.query(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
     select o.firm_id, o.shift_id, o.worker_id, g, 'push', $2
       from offers o, generate_series($3::int, $3::int + $4::int - 1) g
      where o.firm_id = $1 and o.id = $5`,
    [t.firmId, at, o.fromWave ?? 2, n, t.rows.offers],
  );
}

describe("a firm's signals", () => {
  it("send failures: counted over the last hour, WhatsApp and text only, in its own firm", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    await events(t, "offer.sent", 12);
    await events(t, "shift.reminder_sent", 6);
    await events(t, "offer.send_failed", 2, { code: "twilio_21610" });
    await events(t, "message.reply_failed", 1, { code: "timeout" });
    // Login codes count too: since Phase 10 every sender logs its failures (none fails its job).
    await events(t, "auth.otp_sent", 2);
    await events(t, "auth.otp_send_failed", 1, { code: "twilio_21610" });
    // Not counted: over an hour ago, an office email, a worker who turned texts off (their choice,
    // not Twilio's), and another firm's failures.
    await events(t, "offer.send_failed", 40, { minutesAgo: 70, code: "old" });
    await events(t, "auth.link_sent", 50, { channel: "email" });
    await events(t, "request.update_failed", 5, { code: "sms_opted_out" });
    await events(other, "offer.send_failed", 100, { code: "theirs" });
    const alerts = await alertsFor(t);
    expect(alerts).toEqual([
      {
        kind: "send_failures",
        key: `send:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}: 4 of 24 WhatsApps and texts failed to send in the last hour (17%), mostly twilio_21610.`,
      },
    ]);
  });

  it("under the rate, or too few sends: nothing", async () => {
    const t = await createTenant(su);
    await events(t, "offer.sent", 19);
    await events(t, "offer.send_failed", 1, { code: "x" });
    expect(await alertsFor(t)).toEqual([]);
    const few = await createTenant(su);
    await events(few, "offer.send_failed", 19, { code: "x" });
    expect(await alertsFor(few)).toEqual([]);
  });

  it("a failing sheet sync: not worked for 30 minutes, still being tried, enabled, this firm's", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    const source = (firm: Tenant, set: string) =>
      su.query(`update roster_sources set ${set} where firm_id = $1`, [firm.firmId]);
    expect(await alertsFor(t)).toEqual([]);
    // A hiccup: it worked 10 minutes ago.
    await source(
      t,
      "last_error_code = 'sheets_unavailable', last_attempted_at = now(), last_synced_at = now() - interval '10 minutes'",
    );
    expect(await alertsFor(t)).toEqual([]);
    await source(t, "last_synced_at = now() - interval '31 minutes'");
    expect(await alertsFor(t)).toEqual([
      {
        kind: "sync_failing",
        key: `sync:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}'s rota sheet sync is failing (sheets_unavailable).`,
      },
    ]);
    // Another firm failing is its own alert, never this one's.
    await source(other, "last_error_code = 'sheet_not_shared', last_attempted_at = now()");
    expect((await alertsFor(t)).map((a) => a.key)).toEqual([`sync:${t.firmId}`]);
    // Nothing has tried it for over an hour (the sync isn't running): not reported for ever.
    await source(t, "last_attempted_at = now() - interval '61 minutes'");
    expect(await alertsFor(t)).toEqual([]);
    await source(t, "last_attempted_at = now(), enabled = false");
    expect(await alertsFor(t)).toEqual([]);
  });

  it("login links: more than 100 by WhatsApp and text in the last hour, this firm's (14.2)", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    const logins = async (firm: Tenant) =>
      (await alertsFor(firm)).filter((a) => a.kind === "login_links");
    // Sent or tried: 100 in the hour is not more than the threshold.
    await events(t, "auth.link_sent", 90);
    await events(t, "auth.link_send_failed", 10, { code: "timeout" });
    // Not counted: the office's links (by email), links over an hour ago, another firm's.
    await events(t, "auth.link_sent", 50, { channel: "email" });
    await events(t, "auth.link_sent", 50, { minutesAgo: 70 });
    await events(other, "auth.link_sent", 200);
    expect(await logins(t)).toEqual([]);
    await events(t, "auth.link_sent", 1, { channel: "sms" });
    expect(await logins(t)).toEqual([
      {
        kind: "login_links",
        key: `logins:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}: 101 login links by WhatsApp and text in the last hour. A big briefing can do that; if not, someone may be running up the firm's messages. Check the action log's Logins.`,
      },
    ]);
    // The other firm's 200 are its own alert.
    expect((await logins(other)).map((a) => a.key)).toEqual([`logins:${other.firmId}`]);
  });

  it("login links: a slow drip, more than 300 over 24 hours though never 100 in an hour (14.2)", async () => {
    const t = await createTenant(su);
    const logins = async () => (await alertsFor(t)).filter((a) => a.kind === "login_links");
    // 300 through the day, at most 60 in any hour; and 100 more, but over 24 hours ago.
    for (const hoursAgo of [2, 5, 9, 14, 20])
      await events(t, "auth.link_sent", 60, { minutesAgo: hoursAgo * 60 });
    await events(t, "auth.link_sent", 100, { minutesAgo: 25 * 60 });
    // And other sends from earlier in the day: not read for this.
    await events(t, "offer.send_failed", 40, { minutesAgo: 3 * 60, code: "old" });
    expect(await logins()).toEqual([]);
    await events(t, "auth.link_send_failed", 1, { minutesAgo: 23 * 60, code: "timeout" });
    expect(await logins()).toEqual([
      {
        kind: "login_links",
        key: `logins-day:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}: 301 login links by WhatsApp and text in the last 24 hours, far more than a firm needs. Someone may be running up the firm's messages. Check the action log's Logins.`,
      },
    ]);
    // The day's links never count in the last hour's sends: 2 of this hour's 20 failed, 10%.
    await events(t, "offer.sent", 18);
    await events(t, "offer.send_failed", 2, { code: "twilio_21610" });
    expect((await alertsFor(t)).find((a) => a.kind === "send_failures")?.text).toBe(
      `ShiftDesk alert: ${t.slug}: 2 of 20 WhatsApps and texts failed to send in the last hour (10%), mostly twilio_21610.`,
    );
  });
});

describe("a firm's load (P4.8)", () => {
  it("AI fallbacks: more than 20% of at least 20 messages the AI was asked to sort, this hour, this firm's", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    await received(t, 15, { handledAs: "ai", intent: "shifts" });
    await received(t, 3, { handledAs: "office", intent: "office", aiFallback: "no_answer" });
    await received(t, 2, { handledAs: "office", intent: "office", aiFallback: "not_a_label" });
    // Not asked (the AI off; a photo; a keyword), over an hour ago, or another firm's.
    await received(t, 50, { handledAs: "office", intent: "office", aiFallback: "not_connected" });
    await received(t, 50, { handledAs: "office", intent: "office", aiFallback: "no_text" });
    await received(t, 50, { handledAs: "keyword", intent: "pay" });
    await received(t, 40, { handledAs: "office", aiFallback: "no_answer" }, { minutesAgo: 70 });
    await received(other, 40, { handledAs: "office", aiFallback: "no_answer" });
    // 5 of 20: 25%.
    expect(await alertsFor(t)).toEqual([
      {
        kind: "ai_fallbacks",
        key: `ai:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}: the AI couldn't sort 5 of 20 messages in the last hour (25%), so they went to the office. Check the AI's key and Anthropic's status.`,
      },
    ]);
    // 4 of 20 (20%) isn't over: nothing.
    const under = await createTenant(su);
    await received(under, 16, { handledAs: "ai", intent: "pay" });
    await received(under, 4, { handledAs: "office", aiFallback: "no_answer" });
    expect(await alertsFor(under)).toEqual([]);
  });

  it("messages in: more than 1,500 in the last hour, this firm's", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    // The fixture's own message is one; 1,499 more is 1,500: not over.
    await inbound(t, 1_499);
    await inbound(t, 100, { minutesAgo: 70 });
    await inbound(other, 2_000);
    expect(await alertsFor(t)).toEqual([]);
    await inbound(t, 1);
    expect(await alertsFor(t)).toEqual([
      {
        kind: "inbound_volume",
        key: `inbound:${t.firmId}`,
        text: `ShiftDesk alert: ${t.slug}: 1501 messages came in to the shifts line in the last hour, far more than a firm's busiest. A big event can do that; if not, something may be flooding the line.`,
      },
    ]);
  });

  it("offers out: more than 500 in the last hour, this firm's", async () => {
    const t = await createTenant(su);
    const other = await createTenant(su);
    // The fixture's own offer is one; 499 more is 500: not over.
    await offers(t, 499);
    await offers(t, 100, { minutesAgo: 70, fromWave: 1_000 });
    await offers(other, 600);
    expect(await alertsFor(t)).toEqual([]);
    await offers(t, 1, { fromWave: 2_000 });
    expect((await alertsFor(t)).map((a) => [a.kind, a.key])).toEqual([
      ["offer_volume", `offers:${t.firmId}`],
    ]);
  });
});

describe("the queues (P4.8)", () => {
  it("per queue: the jobs due and waiting with the oldest one's wait, and the running ones past 80% of their limit; not the alerts' own", async () => {
    const queue = `p48-health-${Date.now()}`;
    await boss.createQueue(queue);
    try {
      const send = async (o: { startAfter?: number } = {}) => {
        const id = await boss.send(queue, { hello: "x" }, o);
        if (!id) throw new Error("not queued");
        return id;
      };
      const set = (id: string, assignments: string) =>
        su.query(`update pgboss.job set ${assignments} where name = $1 and id = $2`, [queue, id]);
      // Waiting: one due 10 minutes ago, one due now, one in retry whose delay is over.
      const old = await send();
      await set(old, "start_after = now() - interval '10 minutes'");
      await send();
      const retrying = await send();
      await set(retrying, "state = 'retry', start_after = now() - interval '1 minute'");
      // Not waiting: held back for an hour, a retry not yet due, and finished ones.
      await send({ startAfter: 3_600 });
      const later = await send();
      await set(later, "state = 'retry', start_after = now() + interval '5 minutes'");
      const done = await send();
      await set(done, "state = 'completed', completed_on = now()");
      // Running: one at 90% of its 100 seconds, one at 50%.
      const long = await send();
      await set(
        long,
        "state = 'active', expire_seconds = 100, started_on = now() - interval '90 seconds'",
      );
      const fine = await send();
      await set(
        fine,
        "state = 'active', expire_seconds = 100, started_on = now() - interval '50 seconds'",
      );
      // The alerts' own queue is never reported (an alert stuck there can't report itself).
      await boss.send(OPS_ALERT_QUEUE, { kind: "test", key: `p48-${Date.now()}`, text: "x" });
      await su.query(
        "update pgboss.job set start_after = now() - interval '1 hour' where name = $1 and state = 'created'",
        [OPS_ALERT_QUEUE],
      );

      const health = await queueHealth(boss);
      const waiting = health.waiting.find((w) => w.queue === queue);
      expect(waiting?.waiting).toBe(3);
      expect(waiting?.oldestSeconds).toBeGreaterThanOrEqual(600);
      expect(waiting?.oldestSeconds).toBeLessThan(630);
      const running = health.runningLong.find((r) => r.queue === queue);
      expect(running?.count).toBe(1);
      expect(running?.longestShare).toBeGreaterThanOrEqual(0.9);
      expect(running?.longestShare).toBeLessThan(1);
      expect(health.waiting.find((w) => w.queue === OPS_ALERT_QUEUE)).toBeUndefined();
      expect(health.runningLong.find((r) => r.queue === OPS_ALERT_QUEUE)).toBeUndefined();
    } finally {
      await su.query("delete from pgboss.job where name = $1", [queue]);
      await boss.deleteQueue(queue);
    }
  });

  it("the tick: a backlog by each queue's limit, a job running long, and the worker's connection waits", async () => {
    const queued: OpsAlert[] = [];
    const result = await runOpsAlertsTick({
      listFirmIds: async () => [],
      run: withFirm,
      failedJobs: async () => [],
      queueHealth: async () => ({
        waiting: [
          { queue: "inbound-message", waiting: 12, oldestSeconds: 90 }, // limit 60: late
          { queue: "offer-wave", waiting: 2, oldestSeconds: 90 }, // limit 120: fine
          { queue: "pay-digest", waiting: 1, oldestSeconds: 600 }, // limit 900: fine
        ],
        runningLong: [{ queue: "retention-purge", count: 1, longestShare: 0.85 }],
      }),
      connectionWaits: () => ({ slow: 7, timedOut: 0, poolMax: 15 }),
      queue: async (alert) => {
        queued.push(alert);
      },
    });
    expect(result.alerts.map((a) => a.kind)).toEqual([
      "job_backlog",
      "job_running_long",
      "connection_waits",
    ]);
    expect(queued[0]?.text).toBe(
      "ShiftDesk alert: jobs are waiting too long to start: inbound-message 12 waiting, the oldest 90 s (limit 60 s). Check the worker is running and keeping up.",
    );
  });
});

describe("failed jobs", () => {
  it("counts jobs that failed after their last retry in the last hour, by queue, not the alerts' own", async () => {
    const before = (await failedJobCounts(boss)).find((c) => c.queue === HELLO_QUEUE)?.count ?? 0;
    const failOne = async (queue: string) => {
      const id = await boss.send(queue, { hello: "x" }, { retryLimit: 0 });
      if (!id) throw new Error("not queued");
      await su.query(
        "update pgboss.job set state = 'failed', completed_on = now() where name = $1 and id = $2",
        [queue, id],
      );
      return id;
    };
    await failOne(HELLO_QUEUE);
    await failOne(HELLO_QUEUE);
    const old = await failOne(HELLO_QUEUE);
    await su.query(
      "update pgboss.job set completed_on = now() - interval '2 hours' where name = $1 and id = $2",
      [HELLO_QUEUE, old],
    );
    await failOne(OPS_ALERT_QUEUE);
    const counts = await failedJobCounts(boss);
    expect(counts.find((c) => c.queue === HELLO_QUEUE)?.count).toBe(before + 2);
    expect(counts.find((c) => c.queue === OPS_ALERT_QUEUE)).toBeUndefined();
  });
});

describe("the tick", () => {
  it("queues each alert once an hour (a pg-boss singleton per key), and the job sends it", async () => {
    const t = await createTenant(su);
    await su.query(
      "update roster_sources set last_error_code = 'sheets_auth_failed', last_attempted_at = now() where firm_id = $1",
      [t.firmId],
    );
    const tick = () =>
      runOpsAlertsTick({
        listFirmIds: async () => [t.firmId],
        run: withFirm,
        failedJobs: async () => [{ queue: "offer-wave", count: 1 }],
        ...quiet,
        health: async () => ({ ok: false, detail: "no answer" }),
        queue: async (alert) => {
          await queueOpsAlert(boss, alert);
        },
      });
    const first = await tick();
    expect(first.alerts.map((a) => a.kind)).toEqual([
      "job_failures",
      "sync_failing",
      "health_down",
    ]);
    await tick();
    const { rows } = await su.query<{ data: OpsAlert }>(
      "select data from pgboss.job where name = $1 and singleton_key = $2",
      [OPS_ALERT_QUEUE, `sync:${t.firmId}`],
    );
    expect(rows).toHaveLength(1);
    const sent: OpsAlert[] = [];
    const transport: AlertTransport = {
      name: "capture",
      async send(a) {
        sent.push(a);
      },
    };
    await sendOpsAlert(rows[0]?.data, transport);
    expect(sent.map((a) => a.text)).toEqual([
      `ShiftDesk alert: ${t.slug}'s rota sheet sync is failing (sheets_auth_failed).`,
    ]);
    // A payload that isn't an alert is refused, not sent.
    await expect(sendOpsAlert({ kind: "nope", key: "k", text: "t" }, transport)).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("a repeat within a rolling hour isn't queued, even across the clock hour", async () => {
    const alert = syncAlert({
      firmId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      slug: `rolling-${Date.now()}`,
      code: "sheets_unavailable",
    });
    const key = `${alert.key}:${Date.now()}`;
    const mine = { ...alert, key };
    expect(await queueOpsAlert(boss, mine)).toBe(true);
    expect(await queueOpsAlert(boss, mine)).toBe(false);
    // 59 minutes later, in the next clock hour (pg-boss's own slot has moved on): still not.
    await su.query(
      `update pgboss.job set created_on = now() - interval '59 minutes',
              singleton_on = singleton_on - interval '1 hour'
        where name = $1 and singleton_key = $2`,
      [OPS_ALERT_QUEUE, key],
    );
    expect(await queueOpsAlert(boss, mine)).toBe(false);
    // Over an hour: again.
    await su.query(
      "update pgboss.job set created_on = now() - interval '61 minutes' where name = $1 and singleton_key = $2",
      [OPS_ALERT_QUEUE, key],
    );
    expect(await queueOpsAlert(boss, mine)).toBe(true);
  });

  it("one part failing doesn't stop the others", async () => {
    const t = await createTenant(su);
    await su.query(
      "update roster_sources set last_error_code = 'sheets_auth_failed', last_attempted_at = now() where firm_id = $1",
      [t.firmId],
    );
    const queued: OpsAlert[] = [];
    const result = await runOpsAlertsTick({
      listFirmIds: async () => ["00000000-0000-4000-8000-000000000000", t.firmId],
      run: (firmId, fn) =>
        firmId === t.firmId ? withFirm(firmId, fn) : Promise.reject(new Error("broken firm")),
      failedJobs: async () => {
        throw new Error("pgboss unreachable");
      },
      queueHealth: async () => {
        throw new Error("pgboss unreachable");
      },
      connectionWaits: () => {
        throw new Error("no count");
      },
      health: async () => {
        throw new Error("fetch broke");
      },
      queue: async (alert) => {
        queued.push(alert);
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
    });
    expect(result.alerts.map((a) => a.kind)).toEqual(["sync_failing"]);
    expect(queued).toHaveLength(1);
  });

  it("the firms can't be listed: the failed jobs and the health check still alert", async () => {
    const queued: OpsAlert[] = [];
    await runOpsAlertsTick({
      listFirmIds: async () => {
        throw new Error("app role refused");
      },
      run: withFirm,
      failedJobs: async () => [{ queue: "offer-wave", count: 3 }],
      ...quiet,
      health: async () => ({ ok: false, detail: "HTTP 503" }),
      queue: async (alert) => {
        if (alert.kind === "job_failures") throw new Error("queueing one failed");
        queued.push(alert);
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        child() {
          return this;
        },
      },
    });
    // Queueing one alert failing doesn't stop the next either.
    expect(queued.map((a) => a.kind)).toEqual(["health_down"]);
  });

  it("the worker works both queues, and the tick runs every 5 minutes", async () => {
    for (const name of [OPS_ALERTS_TICK_QUEUE, OPS_ALERT_QUEUE]) {
      expect(QUEUES.find((q) => q.name === name)?.options?.policy, name).toBe("standard");
    }
    const worked: string[] = [];
    const scheduled: unknown[][] = [];
    const fake = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        worked.push(name);
        return "id";
      },
      schedule: async (...args: unknown[]) => {
        scheduled.push(args);
      },
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(fake);
    expect(worked).toEqual(expect.arrayContaining([OPS_ALERTS_TICK_QUEUE, OPS_ALERT_QUEUE]));
    expect(scheduled).toContainEqual([OPS_ALERTS_TICK_QUEUE, "*/5 * * * *"]);
  });
});
