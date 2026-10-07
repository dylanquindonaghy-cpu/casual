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

// "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct", for the office's top bar.
export function payWeekLabel(w: PayWeek): string {
  return `Week ${w.week} · ${dayMonth(w.monday)} – ${dayMonth(w.sunday)} · Pay ${dayLabel(w.payDay)}`;
}
