import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import type { RecordedPayDate } from "./next-pay";

// The pay records' pay dates the next pay day needs (src/lib/pay/next-pay.ts; Phase 37.1): for each
// period the records cover, its earliest pay date from today on, for last period and this one (with
// a pay date at all) and any period with a pay date from today on. One read for the office's pay
// dashboard (the whole firm) and the casual's own pay day (`workerId`: her records only). Runs in
// the caller's `withFirm` transaction, so Row Level Security keeps it to that firm.

export interface RecordedPeriodPayDate extends RecordedPayDate {
  end: string; // the records' period_end (yyyy-mm-dd)
}

export async function readRecordedPayDates(
  tx: FirmTx,
  today: string,
  window: { from: string; to: string },
  workerId?: string,
): Promise<RecordedPeriodPayDate[]> {
  const { rows } = await tx.execute<{ start: string; end: string; next: string | null }>(sql`
    select period_start::text as start, period_end::text as "end",
           (min(pay_date) filter (where pay_date >= ${today}::date))::text as next
      from pay_records
     where pay_date is not null
       and (pay_date >= ${today}::date
            or period_start between ${window.from}::date and ${window.to}::date)
       ${workerId === undefined ? sql`` : sql`and worker_id = ${workerId}`}
     group by period_start, period_end`);
  return rows;
}
