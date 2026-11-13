import { addDays } from "../time/zoned";
import { payPeriod, type PayCalendar, type PayPeriod } from "./calendar";

// The next pay day on the pay dashboard (Phase 26.10, fix-1; docs/screens.md "Fixes and words"):
// the first pay day not yet past, and which shifts it pays. Last period's when it's still ahead,
// else this period's: each the pay records' date when they date that period, else the firm's pay
// calendar's. An earlier date in the pay records (an older period paid late, say) comes first. Pure:
// the caller reads the pay records (`readRecordedPayDates`, src/lib/pay/recorded-pay-dates.ts) and
// passes the firm-local date. The office's pay dashboard and the casual's own pay day (Phase 37.1,
// src/lib/portal/pay-day.ts) both use this one rule.

export interface RecordedPayDate {
  start: string; // a pay record's period_start (yyyy-mm-dd)
  next: string | null; // its earliest pay date from today on; null: all of them are past
}

export interface NextPay {
  day: string; // yyyy-mm-dd
  from: "pay records" | "pay calendar";
  periodStart: string; // the first day of the firm's pay period it pays
  periodEnd: string; // its last day (Phase 37.1: "For shifts Mon 2 to Sun 8 Nov")
  thisPeriodPaid: string | null; // this period's own pay day, when that's later than `day`
}

interface Candidate {
  day: string;
  from: NextPay["from"];
  periodStart: string;
}

// The pay records' period starts this lookup needs: last period's and this one's (with a pay date
// at all), and any period with a pay date from today on.
export function recordWindow(today: string, calendar: PayCalendar): { from: string; to: string } {
  const current = payPeriod(today, calendar);
  return { from: payPeriod(addDays(current.start, -1), calendar).start, to: current.end };
}

export function nextPayFor(
  today: string,
  calendar: PayCalendar,
  recorded: readonly RecordedPayDate[],
): NextPay {
  const current = payPeriod(today, calendar);
  const previous = payPeriod(addDays(current.start, -1), calendar);
  // A period's pay day from today on: the pay records' when they date it (none ahead: it's paid),
  // else the calendar's when that's not past.
  const ahead = (p: PayPeriod): Candidate | null => {
    const rows = recorded.filter((r) => r.start >= p.start && r.start <= p.end);
    if (rows.length > 0) {
      const days = rows.flatMap((r) => (r.next !== null && r.next >= today ? [r.next] : []));
      return days.length > 0
        ? { day: days.sort()[0] as string, from: "pay records", periodStart: p.start }
        : null;
    }
    return p.payDay >= today ? { day: p.payDay, from: "pay calendar", periodStart: p.start } : null;
  };
  const thisPeriod = ahead(current);
  const candidates: Candidate[] = [ahead(previous), thisPeriod].filter(
    (c): c is Candidate => c !== null,
  );
  for (const r of recorded) {
    if (r.next !== null && r.next >= today) {
      candidates.push({
        day: r.next,
        from: "pay records",
        periodStart: payPeriod(r.start, calendar).start,
      });
    }
  }
  // The earliest; on the same day, the pay records' over the calendar's, then the earlier period.
  candidates.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.from === b.from ? 0 : a.from === "pay records" ? -1 : 1) ||
      a.periodStart.localeCompare(b.periodStart),
  );
  // Nothing ahead at all (this period dated in the past by its records): the next period's.
  const next: Candidate = candidates[0] ?? {
    day: payPeriod(addDays(current.end, 1), calendar).payDay,
    from: "pay calendar",
    periodStart: addDays(current.end, 1),
  };
  return {
    ...next,
    periodEnd: payPeriod(next.periodStart, calendar).end,
    thisPeriodPaid:
      next.periodStart !== current.start && thisPeriod !== null && thisPeriod.day > next.day
        ? thisPeriod.day
        : null,
  };
}
