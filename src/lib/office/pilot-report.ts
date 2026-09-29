import { eq, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import {
  BASELINE_KEYS,
  DAILY_METRICS,
  TALLY_KEYS,
  type BaselineMetric,
  type DailyMetric,
  type TallyMetric,
} from "../metrics/definitions";
import { mondayOf } from "../metrics/entry";
import { addDays, localDateOf, zonedToUtc } from "../time/zoned";

// The office's pilot metrics page (docs/screens.md `/office/reports/pilot`; docs/pilot-playbook.md):
// the week-0 baseline against the app's own figures for a chosen period. Admins and resourcers:
// the session and role are checked here as well as on the page. Reads only, inside the firm.
// - baseline: the latest figure entered for each metric;
// - tally: the office's weekly counts for weeks starting in the period, averaged;
// - daily: the nightly rollup's counts, added up over the period;
// - live (these can't be added up from daily rows): the median time from a worker's cancellation
//   to the next booking on that shift (within 7 days), the workers booked on a shift in the period,
//   how many of them have ever logged in, and the urgent shifts in the period filled from waves.
// Default period: the last 7 complete days (to yesterday); at most 92 days.

export const PILOT_DEFAULT_DAYS = 7;
export const PILOT_MAX_DAYS = 92;

export interface PilotReport {
  timeZone: string;
  filters: { from: string; to: string };
  clamped: boolean;
  days: number;
  baseline: {
    values: Partial<Record<BaselineMetric, number>>;
    weekStart: string | null;
    updatedAt: Date | null;
  };
  tally: {
    values: Partial<Record<TallyMetric, number>>; // weeks starting in the period, averaged
    weeks: number;
    thisWeek: string; // this week's Monday
    thisWeekValues: Partial<Record<TallyMetric, number>>; // what's saved for this week
  };
  daily: { sums: Record<DailyMetric, number>; daysCounted: number; updatedAt: Date | null };
  live: {
    refillMedianMinutes: number | null;
    refills: number;
    activeWorkers: number;
    activeLoggedIn: number;
    urgentShifts: number; // marked urgent in the period (each shift once)
    urgentFilledByWave: number; // of those, taken from a wave offer (so far)
  };
}

const day = (value: string): string | null => {
  if (!/^(20\d\d|2100)-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
};

export function parsePilotQuery(query: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v.trim() : "";
  };
  return { from: day(one("from")), to: day(one("to")) };
}
export type PilotQuery = ReturnType<typeof parsePilotQuery>;

export async function loadPilotReport(
  tx: FirmTx,
  query: PilotQuery,
  now: Date,
): Promise<PilotReport> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const today = localDateOf(now, timeZone);
  // Complete days by default: the 7 days to yesterday (today's figures are only partial).
  let to =
    query.to ?? (query.from ? addDays(query.from, PILOT_DEFAULT_DAYS - 1) : addDays(today, -1));
  let from = query.from ?? addDays(to, -(PILOT_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  let clamped = false;
  if (from < addDays(to, -(PILOT_MAX_DAYS - 1))) {
    from = addDays(to, -(PILOT_MAX_DAYS - 1));
    clamped = true;
  }
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1,
  );
  const midnight = (d: string) => {
    const [y = 2000, m = 1, dd = 1] = d.split("-").map(Number);
    return zonedToUtc({ year: y, month: m, day: dd, hour: 0, minute: 0 }, timeZone);
  };
  const start = midnight(from);
  const end = midnight(addDays(to, 1));

  // The latest baseline figure for each metric.
  const { rows: baselineRows } = await tx.execute<{
    metric: string;
    value: string;
    day: string;
    updated_at: string | Date;
  }>(sql`
    select distinct on (metric) metric, value::text, day::text, updated_at
      from metrics_daily where kind = 'baseline'
     order by metric, updated_at desc, day desc`);
  const baselineValues: Partial<Record<BaselineMetric, number>> = {};
  let baselineAt: Date | null = null;
  let baselineWeek: string | null = null;
  for (const r of baselineRows) {
    if (!(BASELINE_KEYS as readonly string[]).includes(r.metric)) continue;
    baselineValues[r.metric as BaselineMetric] = Number(r.value);
    const at = new Date(r.updated_at);
    if (!baselineAt || at > baselineAt) {
      baselineAt = at;
      baselineWeek = r.day;
    }
  }

  // The office's weekly tallies for weeks starting in the period (from the Monday of its first
  // week), averaged.
  const { rows: tallyRows } = await tx.execute<{ metric: string; avg: string; weeks: number }>(sql`
    select metric, avg(value)::text as avg, count(*)::int as weeks
      from metrics_daily
     where kind = 'tally' and day >= ${mondayOf(from)}::date and day <= ${to}::date
     group by metric`);
  const tallyValues: Partial<Record<TallyMetric, number>> = {};
  let weeks = 0;
  for (const r of tallyRows) {
    if (!(TALLY_KEYS as readonly string[]).includes(r.metric)) continue;
    tallyValues[r.metric as TallyMetric] = Number(r.avg);
    weeks = Math.max(weeks, r.weeks);
  }

  // The rollup's daily counts over the period.
  const { rows: dailyRows } = await tx.execute<{
    metric: string;
    total: string;
    days: number;
    updated_at: string | Date | null;
  }>(sql`
    select metric, sum(value)::text as total, count(distinct day)::int as days,
           max(updated_at) as updated_at
      from metrics_daily
     where kind = 'daily' and day >= ${from}::date and day <= ${to}::date
     group by metric`);
  const sums = Object.fromEntries(DAILY_METRICS.map((m) => [m, 0])) as Record<DailyMetric, number>;
  let daysCounted = 0;
  let dailyAt: Date | null = null;
  for (const r of dailyRows) {
    if (!(DAILY_METRICS as readonly string[]).includes(r.metric)) continue;
    sums[r.metric as DailyMetric] = Number(r.total);
    daysCounted = Math.max(daysCounted, r.days);
    if (r.updated_at) {
      const at = new Date(r.updated_at);
      if (!dailyAt || at > dailyAt) dailyAt = at;
    }
  }

  // Live: refill time, active workers, adoption.
  const { rows: refill } = await tx.execute<{ median: string | null; n: number }>(sql`
    select percentile_cont(0.5) within group (order by minutes)::text as median,
           count(minutes)::int as n
      from (
        select extract(epoch from (
                 select min(b.created_at) from events b
                  where b.action = 'shift.assigned'
                    and b.data ->> 'shiftId' = c.data ->> 'shiftId'
                    and b.created_at > c.created_at
                    and b.created_at < c.created_at + interval '7 days'
               ) - c.created_at) / 60 as minutes
          from events c
         where c.action = 'shift.cancelled' and c.data ->> 'by' = 'worker'
           and c.created_at >= ${start} and c.created_at < ${end}
      ) x`);
  const { rows: active } = await tx.execute<{ workers: number; logged_in: number }>(sql`
    with booked as (
      select distinct a.worker_id
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
       where a.status in ('confirmed', 'completed', 'no_show')
         and s.starts_at >= ${start} and s.starts_at < ${end}
    ), logged_in as (
      select distinct e.actor_id as worker_id from events e
       where e.action = 'auth.login' and e.actor_type = 'worker' and e.created_at < ${end}
    )
    select count(*)::int as workers, count(l.worker_id)::int as logged_in
      from booked b left join logged_in l on l.worker_id = b.worker_id`);
  // Urgent fill rate over the whole period, each shift once (daily counts can't be added up for
  // this: a shift marked one day and filled the next would count twice, or only on top).
  const { rows: urgent } = await tx.execute<{ marked: number; filled: number }>(sql`
    with marked as (
      select distinct e.entity_id as shift_id from events e
       where e.action = 'shift.marked_urgent'
         and e.created_at >= ${start} and e.created_at < ${end}
    )
    select count(*)::int as marked,
           count(*) filter (where exists (
             select 1 from offers o
              where o.shift_id = m.shift_id and o.wave is not null and o.response = 'accepted'
           ))::int as filled
      from marked m`);
  const { rows: thisWeekRows } = await tx.execute<{ metric: string; value: string }>(sql`
    select metric, value::text from metrics_daily
     where kind = 'tally' and day = ${mondayOf(today)}::date`);
  const thisWeekValues: Partial<Record<TallyMetric, number>> = {};
  for (const r of thisWeekRows) {
    if ((TALLY_KEYS as readonly string[]).includes(r.metric)) {
      thisWeekValues[r.metric as TallyMetric] = Number(r.value);
    }
  }

  return {
    timeZone,
    filters: { from, to },
    clamped,
    days,
    baseline: { values: baselineValues, weekStart: baselineWeek, updatedAt: baselineAt },
    tally: { values: tallyValues, weeks, thisWeek: mondayOf(today), thisWeekValues },
    daily: { sums, daysCounted, updatedAt: dailyAt },
    live: {
      refillMedianMinutes: refill[0]?.median == null ? null : Number(refill[0].median),
      refills: refill[0]?.n ?? 0,
      activeWorkers: active[0]?.workers ?? 0,
      activeLoggedIn: active[0]?.logged_in ?? 0,
      urgentShifts: urgent[0]?.marked ?? 0,
      urgentFilledByWave: urgent[0]?.filled ?? 0,
    },
  };
}

// The page's data for the logged-in office user, or null (logged out, or a role without it).
export async function officePilotReport(
  ctx: AuthContext,
  token: string,
  query: PilotQuery,
): Promise<PilotReport | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "pilot")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadPilotReport(tx, query, now));
}
