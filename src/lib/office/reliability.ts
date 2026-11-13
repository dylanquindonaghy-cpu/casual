import { sql, type SQL } from "drizzle-orm";
import { uuidArray } from "../db/arrays";
import type { FirmTx } from "../db/scoped";
import {
  LATE_NOTICE_HOURS,
  RELIABILITY_DAYS,
  REGULAR_OF_WEEKS,
  reliabilityOf,
  standingOf,
  type CasualStanding,
  type Reliability,
} from "../rules/reliability";

// Each casual's record for reliability (Phase 26.7; decision 3), counted by code from the firm's
// own rows inside its transaction, and handed to the pure rules (src/lib/rules/reliability.ts):
// over the last 90 days, sessions marked worked and not attended (by when the session started) and
// their own cancellations under 48 hours' notice (by when they cancelled); how many of the last 8
// weeks (the firm's weeks) they worked in; and when they last worked.

export interface CasualRecord {
  workerId: string;
  reliability: Reliability;
  standing: CasualStanding;
  lastWorked: Date | null;
  weeksWorked: number;
}

const DAY = 24 * 3_600_000;

// Each casual's counts, added up once over the bookings (by casual), then joined to the casuals.
//
// Why not one join of casuals, bookings and sessions grouped by casual (as before): on a database
// just seeded, its tables not yet analysed, the planner expects one row everywhere and ran that
// join as nested loops with the casual and the session as plain filters, reading every booking
// for each casual and every session for each of those: 143 casuals, 81,367 scans of the sessions,
// 7.9 seconds for the Casuals list (1.7 ms once analysed). Its page waits for it, so a tab's link
// on Casuals (casual.app.spec.ts) left the address unchanged for that long. Added up first, each
// booking is read once whatever join the planner picks (tests/integration/
// reliability.records-plan.test.ts forces that plan).
// `workerIds` null: every casual of the firm.
export function casualRecordsQuery(now: Date, workerIds: string[] | null): SQL {
  const from = new Date(now.getTime() - RELIABILITY_DAYS * DAY);
  const weeksFrom = new Date(now.getTime() - REGULAR_OF_WEEKS * 7 * DAY);
  const ids = workerIds === null ? null : uuidArray(workerIds);
  const only = ids === null ? sql`true` : sql`w.id = any(${ids})`;
  const theirs = ids === null ? sql`a.worker_id is not null` : sql`a.worker_id = any(${ids})`;
  // (Only the bookings these counts look at: worked, not attended, or cancelled by the casual.)
  return sql`
    with record as materialized (
      select a.firm_id, a.worker_id,
        count(*) filter (where a.status = 'completed' and s.starts_at >= ${from}
                           and s.starts_at <= ${now})::int as worked,
        count(*) filter (where a.status = 'no_show' and s.starts_at >= ${from}
                           and s.starts_at <= ${now})::int as no_shows,
        count(*) filter (where a.status = 'cancelled_worker' and a.notice_hours < ${LATE_NOTICE_HOURS}
                           and a.cancelled_at >= ${from} and a.cancelled_at <= ${now})::int as late,
        max(s.starts_at) filter (where a.status = 'completed' and s.starts_at <= ${now}) as last_worked,
        count(distinct date_trunc('week', s.starts_at at time zone f.timezone))
          filter (where a.status = 'completed' and s.starts_at >= ${weeksFrom}
                    and s.starts_at <= ${now})::int as weeks
        from assignments a
        join firms f on f.id = a.firm_id
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
       where ${theirs} and a.status in ('completed', 'no_show', 'cancelled_worker')
       group by a.firm_id, a.worker_id
    )
    select w.id::text as id,
      coalesce(r.worked, 0) as worked, coalesce(r.no_shows, 0) as no_shows,
      coalesce(r.late, 0) as late, r.last_worked, coalesce(r.weeks, 0) as weeks
      from workers w
      left join record r on r.firm_id = w.firm_id and r.worker_id = w.id
     where ${only}
  `;
}

// `workerIds` null: every casual of the firm.
export async function loadCasualRecords(
  tx: FirmTx,
  now: Date,
  workerIds: string[] | null,
): Promise<Map<string, CasualRecord>> {
  const { rows } = await tx.execute<{
    id: string;
    worked: number;
    no_shows: number;
    late: number;
    last_worked: string | Date | null;
    weeks: number;
  }>(casualRecordsQuery(now, workerIds));
  const out = new Map<string, CasualRecord>();
  for (const r of rows) {
    const reliability = reliabilityOf({
      worked: r.worked,
      noShows: r.no_shows,
      lateCancels: r.late,
    });
    const lastWorked = r.last_worked ? new Date(r.last_worked) : null;
    const days = lastWorked ? Math.floor((now.getTime() - lastWorked.getTime()) / DAY) : null;
    out.set(r.id, {
      workerId: r.id,
      reliability,
      standing: standingOf(reliability, r.weeks, days),
      lastWorked,
      weeksWorked: r.weeks,
    });
  }
  return out;
}
