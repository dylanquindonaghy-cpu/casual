import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import { payCalendar } from "../pay/calendar";
import { nextPayFor } from "../pay/next-pay";
import { readRecordedPayDates } from "../pay/recorded-pay-dates";
import { localDateOf } from "../time/zoned";
import type { PortalContext } from "./my-shifts";

// The casual's next pay day (P3; 25.2; Phase 37.1): the office's own rule (src/lib/pay/next-pay.ts,
// the pay dashboard's Next pay day since Phase 26.10 fix-1), so Home, Pay, the shifts line's "Pay
// day" answer and the office all give the same day and the shifts it pays: the first pay day not
// yet past, last period's while it's still to come, else this period's, on the firm's own pay
// calendar (a week, or a fortnight's cycle: src/lib/pay/calendar.ts), or payroll's own date where it
// has imported one for her. Every casual sees a next pay day, whether or not she worked that period
// (Dylan, 2026-11-13): with no record of her own for it, the calendar's. Only her own pay records
// count, and only those covering a whole firm period (the office's read keeps the same ones:
// `readRecordedPayDates`): a record for other dates (a week inside the fortnight) would put its day
// against shifts it doesn't cover (golden rule 9).
// Where the office can differ: its tile reads every casual's records, so it shows payroll's imported
// date for a period, the earliest when there are two. She sees that date only when her own record
// carries it: with a record of hers dated differently she sees hers, and with none for that period
// (she didn't work it, or payroll hasn't sent hers) she sees the calendar's. So whenever payroll's
// date for a period isn't the calendar's, a casual with no record for it sees a different day from
// the office's (a colleague's records never move her day: 37.1; docs/screens.md "One pay day
// everywhere (37.1)"; decision waiting: docs/plan/decisions-waiting.md, Pay and payroll 11).

export interface MyPayDay {
  payDay: string; // yyyy-mm-dd
  days: 7 | 14; // the period's length
  start: string; // the first day (a Monday) of the period that day pays, yyyy-mm-dd
  end: string; // its last day (a Sunday)
  thisPeriodPaid: string | null; // this period's own pay day, when it's later than `payDay`
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
    const today = localDateOf(now, zone);
    const recorded = await readRecordedPayDates(tx, today, calendar, workerId);
    const next = nextPayFor(today, calendar, recorded);
    return {
      payDay: next.day,
      days: calendar.days,
      start: next.periodStart,
      end: next.periodEnd,
      thisPeriodPaid: next.thisPeriodPaid,
    };
  });
}
