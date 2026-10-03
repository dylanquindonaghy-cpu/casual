import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { syncAlert, type AlertTransport, type OpsAlert } from "@/lib/ops/alerts";
import {
  firmAlerts,
  OPS_ALERT_QUEUE,
  OPS_ALERTS_TICK_QUEUE,
  runOpsAlertsTick,
  sendOpsAlert,
} from "@/lib/ops/tick";
import { createBoss } from "@/worker/boss";
import { failedJobCounts, queueOpsAlert, registerJobs } from "@/worker/jobs";
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
