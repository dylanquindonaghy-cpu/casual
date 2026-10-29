import { addDays, localDateOf, mondayOf } from "../time/zoned";
import { payWeek } from "./pay-week";

// The firm's pay calendar (PLAN.md P3.1; "Connecting the firm's systems" 1, replacing D8): pay
// periods of 7 or 14 days counted from an anchor Monday, each paid a set number of days after it
// ends, and called "Week" or "Cycle". Set by the owner with `npm run firm:settings`, stored in
// firms.settings.pay_calendar (docs/data-model.md "Firm settings"). Read whole, like quiet hours:
// with nothing set, or anything the app can't read, today's rule (D8): ISO weeks, Monday to Sunday,
// paid the Friday after. Pure: callers pass a firm-local date, or now and the firm's time zone.
//
// A period's number counts from the anchor's period (1) and carries on across New Year: the
// year-end rule waits for the firm's payroll (`docs/discovery-axlr8.md` §5.5). A day before the
// anchor is in a period with no number.

export const PAY_PERIOD_DAYS = [7, 14] as const;
export type PayPeriodDays = (typeof PAY_PERIOD_DAYS)[number];
export const PAY_PERIOD_LABELS = ["week", "cycle"] as const;
export type PayPeriodLabel = (typeof PAY_PERIOD_LABELS)[number];
export const PAY_DAY_AFTER_MAX = 27;

export interface PayCalendar {
  days: PayPeriodDays;
  anchor: string | null; // a Monday (yyyy-mm-dd) that starts period 1; null: ISO weeks (7 days only)
  payDayAfter: number; // days after the period's last day, a Sunday: 5 is the Friday after
  label: PayPeriodLabel;
}

export const DEFAULT_PAY_CALENDAR: PayCalendar = {
  days: 7,
  anchor: null,
  payDayAfter: 5,
  label: "week",
};

export interface PayPeriod {
  label: PayPeriodLabel;
  number: number | null; // the ISO week with no anchor; else from the anchor's period, 1
  start: string; // yyyy-mm-dd, a Monday
  end: string; // a Sunday
  payDay: string;
}

const isMonday = (day: unknown): day is string =>
  typeof day === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  addDays(day, 0) === day && // a real date ("2026-02-30" isn't)
  mondayOf(day) === day;

// The stored calendar as the app reads it, or null when nothing (or nothing readable) is set.
export function readPayCalendar(raw: unknown): PayCalendar | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (Object.keys(s).length === 0) return null;
  const days = s.days ?? DEFAULT_PAY_CALENDAR.days;
  if (!(PAY_PERIOD_DAYS as readonly unknown[]).includes(days)) return null;
  const anchor = s.anchor ?? null;
  if (anchor !== null && !isMonday(anchor)) return null;
  // Fortnights need a start; weeks without one are ISO weeks.
  if (days !== 7 && anchor === null) return null;
  const payDayAfter = s.pay_day_after ?? DEFAULT_PAY_CALENDAR.payDayAfter;
  if (
    typeof payDayAfter !== "number" ||
    !Number.isInteger(payDayAfter) ||
    payDayAfter < 0 ||
    payDayAfter > PAY_DAY_AFTER_MAX
  ) {
    return null;
  }
  const label = s.label ?? (days === 7 ? "week" : "cycle");
  if (!(PAY_PERIOD_LABELS as readonly unknown[]).includes(label)) return null;
  return {
    days: days as PayPeriodDays,
    anchor,
    payDayAfter,
    label: label as PayPeriodLabel,
  };
}

export function payCalendar(settings: Record<string, unknown>): PayCalendar {
  return readPayCalendar(settings.pay_calendar) ?? DEFAULT_PAY_CALENDAR;
}

const DAY_MS = 86_400_000;
const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// The pay period `day` (yyyy-mm-dd, firm-local) is in.
export function payPeriod(day: string, calendar: PayCalendar = DEFAULT_PAY_CALENDAR): PayPeriod {
  if (calendar.anchor === null) {
    const w = payWeek(day);
    return {
      label: calendar.label,
      number: w.week,
      start: w.monday,
      end: w.sunday,
      payDay: addDays(w.sunday, calendar.payDayAfter),
    };
  }
  const index = Math.floor(daysFrom(calendar.anchor, day) / calendar.days);
  const start = addDays(calendar.anchor, index * calendar.days);
  const end = addDays(start, calendar.days - 1);
  return {
    label: calendar.label,
    number: index >= 0 ? index + 1 : null,
    start,
    end,
    payDay: addDays(end, calendar.payDayAfter),
  };
}

// The period `now` is in, on the firm's calendar (so the clock change can't move it).
export function payPeriodNow(now: Date, timeZone: string, calendar: PayCalendar): PayPeriod {
  return payPeriod(localDateOf(now, timeZone), calendar);
}
