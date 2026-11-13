import { dayLabel, shortDate } from "../rules/reasons";
import { addDays, localDateOf, mondayOf } from "../time/zoned";

// The pay week (docs/office-v2.md D8): the ISO week, Monday to Sunday, paid the Friday after it
// ends. One rule for every firm. Pure: callers pass a firm-local date, or now and the firm's time
// zone.

export interface PayWeek {
  week: number; // the ISO week number: week 1 holds the year's first Thursday (so some years have 53)
  monday: string; // yyyy-mm-dd
  sunday: string;
  payDay: string; // the Friday after the Sunday
}

export function payWeek(day: string): PayWeek {
  const monday = mondayOf(day);
  // The week belongs to the year its Thursday is in.
  const thursday = addDays(monday, 3);
  const jan1 = Date.UTC(Number(thursday.slice(0, 4)), 0, 1);
  const week = Math.floor((Date.parse(`${thursday}T00:00:00Z`) - jan1) / (7 * 86_400_000)) + 1;
  return { week, monday, sunday: addDays(monday, 6), payDay: addDays(monday, 11) };
}

// The week `now` is in, on the firm's calendar (so the clock change can't move it).
export function payWeekNow(now: Date, timeZone: string): PayWeek {
  return payWeek(localDateOf(now, timeZone));
}

// "5 Oct", never with a year (a week spanning New Year reads "28 Dec – 3 Jan").
const dayMonth = (day: string) => shortDate(day, Number(day.slice(0, 4)));

// "Week 45 (paid Fri 13 Nov)": a pay week or cycle and the day its shifts are paid, so it can't be
// read as the next pay day (the launch review's O3: the dashboard's head and the pay dashboard's).
export const payPeriodPaid = (name: string, payDay: string): string =>
  `${name} (paid ${dayLabel(payDay)})`;

// "Mon 2 to Sun 8 Nov"; "Mon 26 Oct to Sun 1 Nov" across two months; "Mon 28 Dec to Sun 3 Jan"
// across New Year (never a year). The one way the casual app, the office and the answer library
// write a pay period's shifts (Phase 37.1).
export function shiftDatesText(start: string, end: string): string {
  const a = dayLabel(start);
  const b = dayLabel(end);
  const first = start.slice(0, 7) === end.slice(0, 7) ? a.replace(/ [A-Z][a-z]{2}$/, "") : a;
  return `${first} to ${b}`;
}

// "Cycle 22 · Mon 26 Oct to Sun 8 Nov" (Phase 25.2; Phase 37.1 dropped "(paid …)", which read as a
// second pay day beside the Next pay day tile): a period of the firm's own pay calendar, for the
// pay dashboard's header.
export function payPeriodLabel(p: { name: string; start: string; end: string }): string {
  return `${p.name} · ${shiftDatesText(p.start, p.end)}`;
}

// The pay dashboard's "Next pay day" lines (Phase 26.10, fix-1; Phase 37.1): "For shifts Mon 2 to
// Sun 8 Nov." (the same words for a cycle), "This week's shifts are paid Fri 20 Nov." ("This
// cycle's" on a cycle) when that's a later day, and "From your pay records." when the date came
// from them.
export function nextPayLines(
  next: {
    from: "pay records" | "pay calendar";
    periodStart: string;
    periodEnd: string;
    thisPeriodPaid: string | null;
  },
  label: "week" | "cycle",
): string[] {
  const lines = [`For shifts ${shiftDatesText(next.periodStart, next.periodEnd)}.`];
  if (next.thisPeriodPaid !== null) {
    lines.push(`This ${label}'s shifts are paid ${dayLabel(next.thisPeriodPaid)}.`);
  }
  if (next.from === "pay records") lines.push("From your pay records.");
  return lines;
}

// "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct", for the office's top bar.
export function payWeekLabel(w: PayWeek): string {
  return `Week ${w.week} · ${dayMonth(w.monday)} – ${dayMonth(w.sunday)} · Pay ${dayLabel(w.payDay)}`;
}

// The same words in their three parts (Phase 23: the office's top bar shows them as words, and
// hides the dates when it's tight): "Week 41", "5 Oct – 11 Oct", "Pay Fri 16 Oct". Joined with
// " · " they are payWeekLabel's.
export interface PayWeekParts {
  week: string;
  dates: string;
  pay: string;
}

export function payWeekParts(w: PayWeek): PayWeekParts {
  return {
    week: `Week ${w.week}`,
    dates: `${dayMonth(w.monday)} – ${dayMonth(w.sunday)}`,
    pay: `Pay ${dayLabel(w.payDay)}`,
  };
}
