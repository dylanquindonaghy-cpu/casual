import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { mondayOf, saveFigures, updateFiguresNow } from "@/lib/metrics/entry";
import {
  countDay,
  METRICS_ROLLUP_QUEUE,
  METRICS_ROLLUP_TICK_QUEUE,
  metricsRollupTask,
  rollupFirm,
  runMetricsRollupTick,
} from "@/lib/metrics/rollup";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { loadPilotReport, officePilotReport, parsePilotQuery } from "@/lib/office/pilot-report";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Pilot metrics (docs/pilot-playbook.md; docs/screens.md `/office/reports/pilot`): the nightly
// rollup's daily counts, the office's baseline and weekly tally, and the page's figures. On the
// real database, as the app role. The day counted is Monday 2 November 2026 (GMT, so London days
// are UTC days); late October is still British Summer Time.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const at = (iso: string) => new Date(iso);

async function metricsFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const event = (o: {
    action: string;
    when: Date;
    actorType?: string;
    actorId?: string | null;
    entityType?: string;
    entityId?: string | null;
    data?: Record<string, unknown>;
  }) =>
    su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        f.firmId,
        o.actorType ?? "system",
        o.actorId ?? null,
        o.action,
        o.entityType ?? "test",
        o.entityId ?? null,
        JSON.stringify(o.data ?? {}),
        o.when,
      ],
    );
  const request = (created: Date, resolved: Date | null) =>
    su.query(
      `insert into requests (firm_id, worker_id, type, status, resolved_at, created_at)
       values ($1, $2, 'general', $3, $4, $5)`,
      [f.firmId, ann, resolved ? "auto_resolved" : "open", resolved, created],
    );
  return { f, resourcer, ann, ben, event, request };
}

const daily = async (firmId: string, day: string) =>
  Object.fromEntries(
    (
      await su.query<{ metric: string; value: string }>(
        "select metric, value::text from metrics_daily where firm_id = $1 and kind = 'daily' and day = $2",
        [firmId, day],
      )
    ).rows.map((r) => [r.metric, Number(r.value)]),
  );

describe("the daily counts", () => {
  it("counts one London day from the firm's rows and events", async () => {
    const t = await metricsFirm();
    const s1 = await t.f.shift({ startsAt: at("2026-11-02T08:00:00Z"), status: "filled" });
    const s2 = await t.f.shift({ startsAt: at("2026-11-03T08:00:00Z") });
    // Logins: Ann twice, Ben once (an office login doesn't count; Sunday night's doesn't either).
    for (const [who, when] of [
      [t.ann, "2026-11-02T08:00:00Z"],
      [t.ann, "2026-11-02T10:00:00Z"],
      [t.ben, "2026-11-02T09:00:00Z"],
      [t.ben, "2026-11-01T23:30:00Z"],
    ] as const) {
      await t.event({ action: "auth.login", when: at(when), actorType: "worker", actorId: who });
    }
    await t.event({
      action: "auth.login",
      when: at("2026-11-02T09:00:00Z"),
      actorType: "office",
      actorId: t.resourcer,
    });
    // Portal actions: three by workers; the office placing someone isn't one.
    await t.event({
      action: "shift.assigned",
      when: at("2026-11-02T10:05:00Z"),
      actorType: "worker",
      actorId: t.ann,
      data: { by: "worker" },
    });
    await t.event({
      action: "request.created",
      when: at("2026-11-02T11:00:00Z"),
      actorType: "worker",
      actorId: t.ben,
    });
    await t.event({
      action: "auth.otp_verified",
      when: at("2026-11-02T12:00:00Z"),
      actorType: "worker",
      actorId: t.ann,
    });
    await t.event({
      action: "shift.assigned",
      when: at("2026-11-02T12:30:00Z"),
      actorType: "office",
      actorId: t.resourcer,
      data: { by: "firm" },
    });
    // Requests: answered in 30 minutes; answered after 25 hours; still waiting after 25 hours;
    // made at 23:00 and waiting 14 hours (not slow yet).
    await t.request(at("2026-11-02T09:00:00Z"), at("2026-11-02T09:30:00Z"));
    await t.request(at("2026-11-02T10:00:00Z"), at("2026-11-03T11:00:00Z"));
    await t.request(at("2026-11-02T12:00:00Z"), null);
    await t.request(at("2026-11-02T23:00:00Z"), null);
    // Cancellations: the worker's with 20 hours' notice (short), the firm's with 100.
    await t.event({
      action: "shift.cancelled",
      when: at("2026-11-02T13:00:00Z"),
      actorType: "worker",
      actorId: t.ann,
      data: { by: "worker", noticeHours: 20 },
    });
    await t.event({
      action: "shift.cancelled",
      when: at("2026-11-02T14:00:00Z"),
      actorType: "office",
      actorId: t.resourcer,
      data: { by: "firm", noticeHours: 100 },
    });
    // Urgent: s1 marked twice, s2 once; s1 taken from a wave offer (an office offer doesn't count).
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-11-02T06:00:00Z"),
      entityType: "shift",
      entityId: s1,
    });
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-11-02T06:30:00Z"),
      entityType: "shift",
      entityId: s1,
    });
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-11-02T07:00:00Z"),
      entityType: "shift",
      entityId: s2,
    });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
       values ($1, $2, $3, 1, 'whatsapp', 'accepted', '2026-11-02T06:10:00Z')`,
      [t.f.firmId, s1, t.ben],
    );
    // Ben took it himself (Take shift).
    await t.event({
      action: "shift.assigned",
      when: at("2026-11-02T06:10:00Z"),
      actorType: "worker",
      actorId: t.ben,
      entityType: "assignment",
      data: { by: "worker", shiftId: s1, workerId: t.ben },
    });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, offered_by, channel, response, responded_at)
       values ($1, $2, $3, $4, 'sms', 'accepted', '2026-11-02T07:10:00Z')`,
      [t.f.firmId, s2, t.ann, t.resourcer],
    );
    // s2's wave offer to Ann is accepted only because the office placed her (Assign): the office
    // filled it, not the wave.
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
       values ($1, $2, $3, 1, 'whatsapp', 'accepted', '2026-11-02T07:20:00Z')`,
      [t.f.firmId, s2, t.ann],
    );
    await t.event({
      action: "shift.assigned",
      when: at("2026-11-02T07:20:00Z"),
      actorType: "office",
      actorId: t.resourcer,
      entityType: "assignment",
      data: { by: "firm", shiftId: s2, workerId: t.ann },
    });
    // No-shows: on Monday's shift (counted), on Tuesday's (not Monday's).
    await t.f.booking(t.ann, s1, "no_show", 1);
    await t.f.booking(t.ben, s2, "no_show", 1);

    const counts = await withFirm(t.f.firmId, (tx) =>
      countDay(tx, "2026-11-02", {
        timeZone: "Europe/London",
        asAt: at("2026-11-03T13:00:00Z"),
        thresholdHours: 48,
      }),
    );
    expect(counts).toEqual({
      worker_logins: 2,
      // Ann's take, her pay page and her own cancellation below, and Ben taking s1 from the wave
      // (Ben's request is for the office).
      portal_actions: 4,
      requests_created: 4,
      requests_due: 3, // all but the one made at 23:00, only 14 hours old
      requests_slow: 2,
      worker_cancellations: 1,
      firm_cancellations: 1,
      short_notice_cancellations: 1,
      urgent_shifts: 2,
      urgent_filled_by_wave: 1,
      no_shows: 1,
    });
  });

  it("days are London days (summer time too), and the short-notice line is the firm's", async () => {
    const t = await metricsFirm({ short_notice_threshold_hours: 120 });
    // 00:30 on 21 October, summer time, is 23:30 on the 20th in UTC.
    await t.event({
      action: "auth.login",
      when: at("2026-10-20T23:30:00Z"),
      actorType: "worker",
      actorId: t.ann,
    });
    await t.event({
      action: "shift.cancelled",
      when: at("2026-10-21T10:00:00Z"),
      data: { by: "firm", noticeHours: 100 },
    });
    const count = (day: string) =>
      withFirm(t.f.firmId, (tx) => rollupFirm(tx, day, at("2026-10-22T12:00:00Z")));
    await count("2026-10-21");
    expect(await daily(t.f.firmId, "2026-10-21")).toMatchObject({
      worker_logins: 1,
      short_notice_cancellations: 1,
    });
    expect(await daily(t.f.firmId, "2026-10-20")).toMatchObject({ worker_logins: 0 });
  });

  it("the roll-up has its own longer limits, whether the job or the office's button runs it (ADR-027)", async () => {
    const t = await metricsFirm();
    // A page's limits (the "Update the figures now" button runs it on the web).
    const asOnTheWeb = createWithFirm(app, {
      limits: { statementMs: 15_000, idleInTransactionMs: 30_000 },
    });
    const after = await asOnTheWeb(t.f.firmId, async (tx) => {
      await rollupFirm(tx, "2026-10-21", at("2026-10-22T12:00:00Z"));
      const { rows } = await tx.execute<{ statement: string; idle: string }>(
        sql`select current_setting('statement_timeout') as statement,
                   current_setting('idle_in_transaction_session_timeout') as idle`,
      );
      return rows[0];
    });
    expect(after).toEqual({ statement: "5min", idle: "1min" });
  });

  it("the rollup stores the last 7 days and today, and running it again corrects late facts", async () => {
    const t = await metricsFirm();
    const s = await t.f.shift({ startsAt: at("2026-10-31T10:00:00Z") }); // Saturday
    const booking = await t.f.booking(t.ann, s, "confirmed", 1);
    const run = () => withFirm(t.f.firmId, (tx) => rollupFirm(tx, "2026-11-02", NOW));
    expect((await run()).days).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    const { rows: n } = await su.query<{ n: number }>(
      "select count(*)::int as n from metrics_daily where firm_id = $1 and kind = 'daily'",
      [t.f.firmId],
    );
    expect(n[0]?.n).toBe(8 * 11);
    expect((await daily(t.f.firmId, "2026-10-31")).no_shows).toBe(0);
    // Marked as not attended on Monday: the next rollup counts it for Saturday, and adds no rows.
    await su.query("update assignments set status = 'no_show' where id = $1", [booking]);
    await run();
    expect((await daily(t.f.firmId, "2026-10-31")).no_shows).toBe(1);
    const { rows: again } = await su.query<{ n: number }>(
      "select count(*)::int as n from metrics_daily where firm_id = $1 and kind = 'daily'",
      [t.f.firmId],
    );
    expect(again[0]?.n).toBe(88);
  });

  it("the tick queues one job per firm per London date; the job rolls up for that date", async () => {
    const t = await metricsFirm();
    const other = await metricsFirm();
    const tick = () =>
      runMetricsRollupTick({
        listFirmIds: async () => [t.f.firmId, other.f.firmId],
        run: withFirm,
        clock: { now: () => at("2026-11-03T00:30:00Z") },
      });
    expect(await tick()).toEqual({ queued: 2 });
    expect(await tick()).toEqual({ queued: 0 });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [METRICS_ROLLUP_QUEUE, t.f.firmId],
    );
    expect(rows.map((r) => r.data)).toEqual([
      { firmId: t.f.firmId, idempotencyKey: "metrics-rollup:2026-11-03" },
    ]);
    await runFirmTask(
      metricsRollupTask(() => ({ now: () => at("2026-11-03T00:30:00Z") })),
      { id: "job", data: rows[0]?.data ?? {} },
      withFirm,
    );
    expect(Object.keys(await daily(t.f.firmId, "2026-11-03"))).toHaveLength(11);
    expect(await daily(other.f.firmId, "2026-11-03")).toEqual({});
  });

  it("the worker works the queue, and the tick is scheduled for 00:30 London", async () => {
    expect(QUEUES.find((q) => q.name === METRICS_ROLLUP_QUEUE)).toBeDefined();
    expect(QUEUES.find((q) => q.name === METRICS_ROLLUP_TICK_QUEUE)).toBeDefined();
    const worked: string[] = [];
    const scheduled: unknown[][] = [];
    const boss = {
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
    await registerJobs(boss);
    expect(worked).toEqual(
      expect.arrayContaining([METRICS_ROLLUP_QUEUE, METRICS_ROLLUP_TICK_QUEUE]),
    );
    expect(scheduled).toContainEqual([
      METRICS_ROLLUP_TICK_QUEUE,
      "30 0 * * *",
      null,
      { tz: "Europe/London" },
    ]);
  });
});

describe("the office's figures", () => {
  it("saves the baseline (a blank keeps what's there), logs it with numbers only", async () => {
    const t = await metricsFirm();
    const save = (values: Record<string, string>, weekStart = "2026-10-05") =>
      saveFigures(
        withFirm,
        t.f.firmId,
        {
          kind: "baseline",
          weekStart,
          values,
          by: { type: "office", id: t.resourcer },
        },
        { clock: { now: () => NOW } },
      );
    expect(
      await save({ emails_per_day: "40", calls_per_day: "12.5", unanswered_pct: "40" }),
    ).toEqual({
      status: "saved",
      weekStart: "2026-10-05",
      count: 3,
    });
    expect(await save({ emails_per_day: "", calls_per_day: "15" })).toMatchObject({ count: 1 });
    const { rows } = await su.query<{
      metric: string;
      value: string;
      recorded_by: string;
      day: string;
    }>(
      `select metric, value::text, recorded_by::text, day::text from metrics_daily
        where firm_id = $1 and kind = 'baseline' order by metric`,
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { metric: "calls_per_day", value: "15.00", recorded_by: t.resourcer, day: "2026-10-05" },
      { metric: "emails_per_day", value: "40.00", recorded_by: t.resourcer, day: "2026-10-05" },
      { metric: "unanswered_pct", value: "40.00", recorded_by: t.resourcer, day: "2026-10-05" },
    ]);
    const { rows: logged } = await su.query<{ action: string; data: Record<string, unknown> }>(
      "select action, data from events where firm_id = $1 and action like 'metrics.%' order by id",
      [t.f.firmId],
    );
    expect(logged).toEqual([
      {
        action: "metrics.baseline_saved",
        data: {
          weekStart: "2026-10-05",
          figures: [
            { metric: "emails_per_day", value: 40 },
            { metric: "calls_per_day", value: 12.5 },
            { metric: "unanswered_pct", value: 40 },
          ],
        },
      },
      {
        action: "metrics.baseline_saved",
        data: { weekStart: "2026-10-05", figures: [{ metric: "calls_per_day", value: 15 }] },
      },
    ]);
  });

  it("refuses figures that aren't numbers in range, and an empty form; payroll can't save", async () => {
    const t = await metricsFirm();
    const save = (values: Record<string, string>, by = t.resourcer) =>
      saveFigures(withFirm, t.f.firmId, {
        kind: "baseline",
        weekStart: "2026-10-05",
        values,
        by: { type: "office", id: by },
      });
    expect(
      await save({
        emails_per_day: "lots",
        unanswered_pct: "140",
        calls_per_day: "3.555",
        no_shows_per_week: "-1",
      }),
    ).toEqual({
      status: "invalid",
      problems: ["emails_per_day", "calls_per_day", "unanswered_pct", "no_shows_per_week"],
    });
    expect(await save({ emails_per_day: " " })).toEqual({ status: "nothing" });
    expect(await save({ emails_per_day: "3" }, await t.f.office("payroll"))).toEqual({
      status: "not_allowed",
    });
    const { rows } = await su.query("select 1 from metrics_daily where firm_id = $1", [t.f.firmId]);
    expect(rows).toEqual([]);
  });

  it("a weekly tally is kept against that week's Monday", async () => {
    const t = await metricsFirm();
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    const result = await saveFigures(withFirm, t.f.firmId, {
      kind: "tally",
      weekStart: "2026-11-05",
      values: { calls_per_day: "6", unanswered_pct: "5" }, // not a tally figure: ignored
      by: { type: "office", id: t.resourcer },
    });
    expect(result).toEqual({ status: "saved", weekStart: "2026-11-02", count: 1 });
  });
});

describe("the page's figures", () => {
  it("baseline against now: the latest baseline, the week's tally, the daily sums and the live figures", async () => {
    const t = await metricsFirm();
    const by = { type: "office" as const, id: t.resourcer };
    await saveFigures(withFirm, t.f.firmId, {
      kind: "baseline",
      weekStart: "2026-10-05",
      values: { calls_per_day: "12", refill_minutes: "240" },
      by,
    });
    await saveFigures(withFirm, t.f.firmId, {
      kind: "tally",
      weekStart: "2026-10-27",
      values: { calls_per_day: "6" },
      by,
    });
    // A worker cancels at 10:00 on Monday; the place is taken again at 11:30 (90 minutes).
    const s = await t.f.shift({ startsAt: at("2026-11-04T08:00:00Z") });
    await t.f.booking(t.ann, s, "confirmed", 1);
    await t.event({
      action: "shift.cancelled",
      when: at("2026-11-02T08:00:00Z"),
      actorType: "worker",
      actorId: t.ben,
      data: { by: "worker", shiftId: s, noticeHours: 48 },
    });
    await t.event({
      action: "shift.assigned",
      when: at("2026-11-02T09:30:00Z"),
      actorType: "worker",
      actorId: t.ann,
      data: { by: "worker", shiftId: s },
    });
    // Booked on shifts in these dates: Ann (who has logged in) and Ben (who hasn't).
    const s2 = await t.f.shift({ startsAt: at("2026-10-30T08:00:00Z") });
    await t.f.booking(t.ben, s2, "completed", 1);
    const s3 = await t.f.shift({ startsAt: at("2026-10-28T08:00:00Z") });
    await t.f.booking(t.ann, s3, "completed", 1);
    await t.event({
      action: "auth.login",
      when: at("2026-10-29T08:00:00Z"),
      actorType: "worker",
      actorId: t.ann,
    });
    // One shift marked urgent on two days (counted once), filled from a wave offer.
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-10-28T06:00:00Z"),
      entityType: "shift",
      entityId: s,
    });
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-10-29T06:00:00Z"),
      entityType: "shift",
      entityId: s,
    });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
       values ($1, $2, $3, 1, 'whatsapp', 'accepted', '2026-10-30T06:00:00Z')`,
      [t.f.firmId, s, t.ann],
    );
    await t.event({
      action: "shift.assigned",
      when: at("2026-10-30T06:00:00Z"),
      actorType: "worker",
      actorId: t.ann,
      entityType: "assignment",
      data: { by: "worker", shiftId: s, workerId: t.ann },
    });
    // A second urgent shift whose wave offer is accepted only because the office placed the worker:
    // urgent, but not filled from an offer.
    const placed = await t.f.shift({ startsAt: at("2026-11-05T08:00:00Z") });
    await t.event({
      action: "shift.marked_urgent",
      when: at("2026-10-29T07:00:00Z"),
      entityType: "shift",
      entityId: placed,
    });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
       values ($1, $2, $3, 1, 'whatsapp', 'accepted', '2026-10-30T07:00:00Z')`,
      [t.f.firmId, placed, t.ben],
    );
    await t.event({
      action: "shift.assigned",
      when: at("2026-10-30T07:00:00Z"),
      actorType: "office",
      entityType: "assignment",
      data: { by: "firm", shiftId: placed, workerId: t.ben },
    });
    await withFirm(t.f.firmId, (tx) => rollupFirm(tx, "2026-11-02", NOW));

    // The default is the 7 complete days to yesterday; these dates include Monday (today).
    const byDefault = await withFirm(t.f.firmId, (tx) =>
      loadPilotReport(tx, parsePilotQuery({}), NOW),
    );
    expect(byDefault.filters).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    const r = await withFirm(t.f.firmId, (tx) =>
      loadPilotReport(tx, parsePilotQuery({ from: "2026-10-27", to: "2026-11-02" }), NOW),
    );
    expect(r.filters).toEqual({ from: "2026-10-27", to: "2026-11-02" });
    expect(r.days).toBe(7);
    expect(r.baseline).toMatchObject({
      values: { calls_per_day: 12, refill_minutes: 240 },
      weekStart: "2026-10-05",
    });
    expect(r.tally).toMatchObject({
      values: { calls_per_day: 6 },
      weeks: 1,
      thisWeek: "2026-11-02",
    });
    // Portal actions: the cancellation and the retake on Monday, and Ann taking the urgent shift
    // from its wave offer on the 30th.
    expect(r.daily.sums).toMatchObject({ worker_cancellations: 1, portal_actions: 3 });
    expect(r.daily.daysCounted).toBe(7);
    expect(r.live).toEqual({
      refillMedianMinutes: 90,
      refills: 1,
      activeWorkers: 2,
      activeLoggedIn: 1,
      urgentShifts: 2, // one taken from the wave, one placed by the office
      urgentFilledByWave: 1,
    });
  });

  it("only this firm's figures; payroll and logged-out people get nothing", async () => {
    const t = await metricsFirm();
    const other = await metricsFirm();
    await saveFigures(withFirm, other.f.firmId, {
      kind: "baseline",
      weekStart: "2026-10-05",
      values: { calls_per_day: "99" },
      by: { type: "office", id: other.resourcer },
    });
    await withFirm(other.f.firmId, (tx) => rollupFirm(tx, "2026-11-02", NOW));
    const r = await withFirm(t.f.firmId, (tx) => loadPilotReport(tx, parsePilotQuery({}), NOW));
    expect(r.baseline.values).toEqual({});
    expect(r.daily.daysCounted).toBe(0);

    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const sessionFor = async (officeUserId: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
        )
      ).token;
    const q = parsePilotQuery({});
    expect(await officePilotReport(ctx, await sessionFor(t.resourcer), q)).not.toBeNull();
    expect(
      await officePilotReport(ctx, await sessionFor(await t.f.office("payroll")), q),
    ).toBeNull();
    expect(await officePilotReport(ctx, "", q)).toBeNull();
  });

  it("'Update the figures now' rolls up today for the firm; payroll can't", async () => {
    const t = await metricsFirm();
    expect(
      await updateFiguresNow(
        withFirm,
        t.f.firmId,
        { type: "office", id: t.resourcer },
        { clock: { now: () => NOW } },
      ),
    ).toEqual({ status: "updated", days: 8 });
    expect(Object.keys(await daily(t.f.firmId, "2026-11-02"))).toHaveLength(11);
    expect(
      await updateFiguresNow(withFirm, t.f.firmId, {
        type: "office",
        id: await t.f.office("payroll"),
      }),
    ).toEqual({ status: "not_allowed" });
  });
});
