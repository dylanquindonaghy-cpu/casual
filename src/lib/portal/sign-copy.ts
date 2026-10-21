import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import { roleLabel } from "./format";

// How the casual app's "sign" parts read (Phase 18: the date tile, the time in sign figures, the
// pass's "In 3 days"), in the firm's time zone. Pure: the page passes the time zone and now.

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const LONG_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

// The weekday of a yyyy-mm-dd date, Monday first (0).
const weekdayOf = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return (new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
};

export interface DateParts {
  dow: string; // "Sat"
  day: string; // "24"
  month: string; // "Oct"
  long: string; // "Saturday 24 October", for screen readers
}

// A calendar date's parts (yyyy-mm-dd).
export function datePartsOfDay(isoDate: string): DateParts {
  const [, m, d] = isoDate.split("-").map(Number);
  const w = weekdayOf(isoDate);
  const month = (m ?? 1) - 1;
  return {
    dow: SHORT_DAYS[w]!,
    day: String(d ?? 1),
    month: SHORT_MONTHS[month]!,
    long: `${LONG_DAYS[w]} ${d ?? 1} ${LONG_MONTHS[month]}`,
  };
}

// The parts of the day an instant falls on, in the zone.
export const dateParts = (instant: Date, timeZone: string): DateParts =>
  datePartsOfDay(localDateOf(instant, timeZone));

const clock = (instant: Date, timeZone: string) => {
  const w = wallTimeOf(instant, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// "14:00–22:00" (an en dash), and for a shift that ends on a later day, what to say under it
// ("Finishes Sunday morning"; "Finishes Sunday" from midday). Ending at midnight belongs to the
// day it started ("19:00–00:00", no note).
export function timeRange(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
): { range: string; endsNote: string | null; spoken: string } {
  const start = clock(startsAt, timeZone);
  const end = clock(endsAt, timeZone);
  const startDay = localDateOf(startsAt, timeZone);
  const lastDay = localDateOf(new Date(endsAt.getTime() - 1), timeZone);
  const endsLater = lastDay !== startDay;
  const endDay = localDateOf(endsAt, timeZone);
  const morning = wallTimeOf(endsAt, timeZone).hour < 12;
  return {
    range: `${start}–${end}`,
    endsNote: endsLater
      ? `Finishes ${LONG_DAYS[weekdayOf(endDay)]}${morning ? " morning" : ""}`
      : null,
    spoken: `${start} to ${end === "00:00" ? "midnight" : end}`,
  };
}

// How far off a shift is, on the pass's band: "On now", "Today", "Tomorrow", "In 3 days".
export function inDays(startsAt: Date, endsAt: Date, now: Date, timeZone: string): string {
  if (startsAt.getTime() <= now.getTime() && now.getTime() < endsAt.getTime()) return "On now";
  const today = localDateOf(now, timeZone);
  const day = localDateOf(startsAt, timeZone);
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  const days = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return `In ${days} days`;
}

// "1 place left", "3 places left"; with the total, "1 of 4 places left"; none: "No places left".
export function placesLeftText(left: number, total?: number): string {
  if (left <= 0) return "No places left";
  const of = total !== undefined ? ` of ${total}` : "";
  return `${left}${of} ${left === 1 && total === undefined ? "place" : "places"} left`;
}

// One line for a shift ("Steward, Sat 24 Oct, 14:00–22:00"): the role, the day, the times.
export function shiftLine(role: string, startsAt: Date, endsAt: Date, timeZone: string): string {
  const p = dateParts(startsAt, timeZone);
  return `${roleLabel(role)}, ${p.dow} ${p.day} ${p.month}, ${timeRange(startsAt, endsAt, timeZone).range}`;
}
