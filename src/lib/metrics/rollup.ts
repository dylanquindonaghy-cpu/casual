import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { firms, metricsDaily } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { shortNoticeThreshold } from "../office/notice-report";
import { addDays, localDateOf, zonedToUtc } from "../time/zoned";
import { DAILY_METRICS, type DailyMetric } from "./definitions";

// The pilot's nightly figures (docs/pilot-playbook.md "Metrics"; docs/api-and-jobs.md
// `metrics-rollup`). A tick at 00:30 London queues one metrics-rollup job per firm per local date
// (a second tick the same day queues nothing new; one firm's failure never stops the others). The
// job recomputes the firm's counts for the last 7 days and today so far (upserts: running it again
// changes nothing), so a late fact still counts: a no-show marked days later, a request answered
// late. The office's "Update the figures now" runs the same code at once.
//
// Each day is the firm's local day. The counts, all from this firm's rows (RLS):
// - worker_logins: workers who logged in (each once a day);
// - portal_actions: workers doing it themselves (take, cancel, days off, settings, pay page);
// - requests_created: requests for the office (someone has to answer them);
// - requests_due: made that day and answered, or 24 hours old at the time of the rollup (so
//   whether they were answered in time is known); requests_slow: of those, answered after 24
//   hours or still waiting;
// - worker_cancellations / firm_cancellations; short_notice_cancellations: either, under the
//   firm's short-notice threshold (the notice report's);
// - urgent_shifts: shifts marked urgent; urgent_filled_by_wave: shifts a worker took from a wave
//   offer that day;
// - no_shows: bookings marked not attended, on shifts starting that day.

export const METRICS_ROLLUP_QUEUE = "metrics-rollup";
export const METRICS_ROLLUP_TICK_QUEUE = "metrics-rollup-tick";
export const METRICS_ROLLUP_CRON = "30 0 * * *";
export const METRICS_ROLLUP_TZ = "Europe/London";
export const ROLLUP_DAYS_BACK = 7;

const KEY_PREFIX = "metrics-rollup:";
const DAY_SECONDS = 24 * 60 * 60;

// The date rides in the key, so a retry after midnight still rolls up for that date.
export const metricsRollupPayload = firmJobEnvelope.extend({
  idempotencyKey: z
    .string()
    .regex(/^metrics-rollup:\d{4}-\d{2}-\d{2}$/)
    .refine((key) => {
      const date = key.slice(KEY_PREFIX.length);
      return addDays(date, 0) === date;
    }, "a real calendar date"),
});
export type MetricsRollupPayload = z.infer<typeof metricsRollupPayload>;
const job = { queue: METRICS_ROLLUP_QUEUE, schema: metricsRollupPayload };

const PORTAL_ACTIONS = [
  "shift.assigned",
  "shift.cancelled",
  "worker.unavailable_added",
  "worker.unavailable_removed",
  "worker.notification_settings_changed",
  "auth.otp_verified",
];

const midnight = (day: string, timeZone: string) => {
  const [y = 2000, m = 1, d = 1] = day.split("-").map(Number);
  return zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, timeZone);
};

// One firm-local day's counts.
export async function countDay(
  tx: FirmTx,
  day: string,
  opts: { timeZone: string; asAt: Date; thresholdHours: number },
): Promise<Record<DailyMetric, number>> {
  const start = midnight(day, opts.timeZone);
  const end = midnight(addDays(day, 1), opts.timeZone);
  // Only these fixed column names are ever written into the query (never anything from input).
  type TimeColumn = "e.created_at" | "r.created_at" | "o.responded_at" | "s.starts_at";
  const inDay = (column: TimeColumn) =>
    sql`${sql.raw(column)} >= ${start} and ${sql.raw(column)} < ${end}`;
  const actions = sql.join(
    PORTAL_ACTIONS.map((a) => sql`${a}`),
    sql`, `,
  );
  const { rows } = await tx.execute<Record<DailyMetric, number>>(sql`
    select
      (select count(distinct e.actor_id)::int from events e
        where e.action = 'auth.login' and e.actor_type = 'worker' and ${inDay("e.created_at")})
        as worker_logins,
      (select count(*)::int from events e
        where e.actor_type = 'worker' and e.action in (${actions}) and ${inDay("e.created_at")})
        as portal_actions,
      (select count(*)::int from requests r where ${inDay("r.created_at")}) as requests_created,
      (select count(*)::int from requests r
        where ${inDay("r.created_at")}
          and (r.resolved_at is not null or r.created_at + interval '24 hours' < ${opts.asAt}))
        as requests_due,
      (select count(*)::int from requests r
        where ${inDay("r.created_at")}
          and ((r.resolved_at is not null and r.resolved_at > r.created_at + interval '24 hours')
            or (r.resolved_at is null and r.created_at + interval '24 hours' < ${opts.asAt})))
        as requests_slow,
      (select count(*)::int from events e
        where e.action = 'shift.cancelled' and e.data ->> 'by' = 'worker' and ${inDay("e.created_at")})
        as worker_cancellations,
      (select count(*)::int from events e
        where e.action = 'shift.cancelled' and coalesce(e.data ->> 'by', '') <> 'worker'
          and ${inDay("e.created_at")})
        as firm_cancellations,
      (select count(*)::int from events e
        where e.action = 'shift.cancelled' and ${inDay("e.created_at")}
          and (case when e.data ->> 'noticeHours' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                    then (e.data ->> 'noticeHours')::numeric end) < ${opts.thresholdHours})
        as short_notice_cancellations,
      (select count(distinct e.entity_id)::int from events e
        where e.action = 'shift.marked_urgent' and ${inDay("e.created_at")})
        as urgent_shifts,
      (select count(distinct o.shift_id)::int from offers o
        where o.wave is not null and o.response = 'accepted' and ${inDay("o.responded_at")}
          -- taken by the worker (Take shift), not placed by the office or named on the sheet
          and exists (select 1 from events b
                       where b.action = 'shift.assigned' and b.data ->> 'by' = 'worker'
                         and b.data ->> 'shiftId' = o.shift_id::text
                         and b.data ->> 'workerId' = o.worker_id::text))
        as urgent_filled_by_wave,
      (select count(*)::int from assignments a
         join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        where a.status = 'no_show' and ${inDay("s.starts_at")})
        as no_shows
  `);
  const row = rows[0];
  return Object.fromEntries(DAILY_METRICS.map((m) => [m, Number(row?.[m] ?? 0)])) as Record<
    DailyMetric,
    number
  >;
}

// Recomputes the last 7 days and `date` (the firm's local date) and stores them. Returns the days.
export async function rollupFirm(
  tx: FirmTx,
  date: string,
  asAt: Date,
): Promise<{ days: string[] }> {
  const [firm] = await tx
    .select({ id: firms.id, timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  if (!firm) throw new Error("no firm for this transaction");
  const thresholdHours = shortNoticeThreshold(firm.settings).hours;
  const days: string[] = [];
  for (let back = ROLLUP_DAYS_BACK; back >= 0; back--) {
    const day = addDays(date, -back);
    const counts = await countDay(tx, day, { timeZone: firm.timezone, asAt, thresholdHours });
    await tx
      .insert(metricsDaily)
      .values(
        DAILY_METRICS.map((metric) => ({
          firmId: firm.id,
          day,
          kind: "daily" as const,
          metric,
          value: String(counts[metric]),
        })),
      )
      .onConflictDoUpdate({
        target: [metricsDaily.firmId, metricsDaily.kind, metricsDaily.day, metricsDaily.metric],
        set: { value: sql`excluded.value`, updatedAt: asAt },
      });
    days.push(day);
  }
  return { days };
}

export function metricsRollupTask(clock: () => Clock): FirmTask<MetricsRollupPayload> {
  return {
    ...job,
    task: (payload, run) =>
      run(payload.firmId, (tx) =>
        rollupFirm(tx, payload.idempotencyKey.slice(KEY_PREFIX.length), clock().now()),
      ),
  };
}
export const metricsRollupFirmTask = metricsRollupTask(() => systemClock);

export interface MetricsTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One rollup per firm per local date.
export async function runMetricsRollupTick(deps: MetricsTickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const id = await deps.run(firmId, async (tx) => {
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, firmId));
        if (!firm) return null;
        const key = `${KEY_PREFIX}${localDateOf(now, firm.timezone)}`;
        return sendFirmJob(
          tx,
          job,
          { idempotencyKey: key },
          { singletonKey: key, singletonSeconds: DAY_SECONDS },
        );
      });
      if (id !== null) queued += 1;
    } catch (err) {
      logger.error("metrics rollup tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
