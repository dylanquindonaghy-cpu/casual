import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import { payCalendar, payPeriod } from "../pay/calendar";
import { nextPayFor, recordWindow } from "../pay/next-pay";
import { readRecordedPayDates } from "../pay/recorded-pay-dates";
import { localDateOf } from "../time/zoned";
import type { PortalContext } from "./my-shifts";

// The casual's next pay day (P3; 25.2; Phase 37.1): the office's own rule (src/lib/pay/next-pay.ts,
// the pay dashboard's Next pay day since Phase 26.10 fix-1), so Home, Pay, the shifts line's "Pay
// day" answer and the office all give the same day and the shifts it pays: the first pay day not
// yet past, last period's while it's still to come, else this period's, on the firm's own pay
// calendar (a week, or a fortnight's cycle: src/lib/pay/calendar.ts), or payroll's own date where it
// has imported one. Every casual sees the firm's next pay day, whether or not she worked that
// period (Dylan, 2026-11-13). Only her own pay records count, and only those covering a whole firm
// period: a record for other dates (a week inside the fortnight) would put its day against shifts
// it doesn't cover (golden rule 9).

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
    const recorded = await readRecordedPayDates(tx, today, recordWindow(today, calendar), workerId);
    const whole = recorded.filter((r) => {
      const p = payPeriod(r.start, calendar);
      return p.start === r.start && p.end === r.end;
    });
    const next = nextPayFor(today, calendar, whole);
    return {
      payDay: next.day,
      days: calendar.days,
      start: next.periodStart,
      end: next.periodEnd,
      thisPeriodPaid: next.thisPeriodPaid,
    };
  });
}
