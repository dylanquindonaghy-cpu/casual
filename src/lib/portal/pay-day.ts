import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import { payCalendar, payPeriodNow } from "../pay/calendar";
import type { PortalContext } from "./my-shifts";

// Home's pay day (P3; 25.2): the day this pay period's shifts are paid, on the firm's own pay
// calendar (a week, or a fortnight's cycle: src/lib/pay/calendar.ts), or payroll's own date when it
// has imported one for her for exactly this period (pay_records.pay_date, as the office's pay page
// reads it). A record for other dates (a week inside the fortnight) isn't used: its day would be
// shown against shifts it doesn't cover (golden rule 9).

export interface MyPayDay {
  payDay: string; // yyyy-mm-dd
  days: 7 | 14; // the period's length
  start: string; // the period's first day (a Monday), yyyy-mm-dd
  end: string; // its last day (a Sunday)
}

type Ctx = PortalContext & { firm: { id: string } };

export async function myPayDay(ctx: Ctx, workerId: string): Promise<MyPayDay> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const { rows: firmRows } = await tx.execute<{
      settings: Record<string, unknown>;
      timezone: string;
    }>(sql`select settings, timezone from firms where id = app_current_firm_id()`);
    const zone = firmRows[0]?.timezone ?? "Europe/London";
    const calendar = payCalendar(firmRows[0]?.settings ?? {});
    const period = payPeriodNow(now, zone, calendar);
    const { rows } = await tx.execute<{ pay_date: string }>(sql`
      select pay_date::text as pay_date from pay_records
      where worker_id = ${workerId} and period_start = ${period.start}::date
        and period_end = ${period.end}::date and pay_date is not null
      order by pay_date limit 1`);
    return {
      payDay: rows[0]?.pay_date ?? period.payDay,
      days: calendar.days,
      start: period.start,
      end: period.end,
    };
  });
}
