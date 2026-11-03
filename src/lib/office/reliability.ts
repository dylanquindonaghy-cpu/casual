import { sql } from "drizzle-orm";
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

// `workerIds` null: every casual of the firm.
export async function loadCasualRecords(
  tx: FirmTx,
  now: Date,
  workerIds: string[] | null,
): Promise<Map<string, CasualRecord>> {
  const from = new Date(now.getTime() - RELIABILITY_DAYS * DAY);
  const weeksFrom = new Date(now.getTime() - REGULAR_OF_WEEKS * 7 * DAY);
  const only = workerIds === null ? sql`true` : sql`w.id = any(${uuidArray(workerIds)})`;
  const { rows } = await tx.execute<{
    id: string;
    worked: number;
    no_shows: number;
    late: number;
    last_worked: string | Date | null;
    weeks: number;
  }>(sql`
    select w.id::text as id,
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
      from workers w
      join firms f on f.id = w.firm_id
      left join assignments a on a.firm_id = w.firm_id and a.worker_id = w.id
      left join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
     where ${only}
     group by w.id
  `);
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
