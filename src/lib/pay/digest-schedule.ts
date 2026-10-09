import { z } from "zod";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";

// When the payroll digest goes (docs/data-model.md "Firm settings", `pay_digest`): a firm-local
// time on chosen days of the week, default 09:00 Monday to Friday. Pure functions: callers pass the
// firm's settings, time zone and now.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DigestSchedule {
  time: string; // "09:00", firm-local
  days: Weekday[]; // in week order; empty: no scheduled digest
}

export const DEFAULT_DIGEST_SCHEDULE: DigestSchedule = {
  time: "09:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const days = z.array(z.enum(WEEKDAYS)).max(7);

// The firm's schedule, field by field: a time or day list that makes no sense gets the default (a
// job must never stop over a setting; the settings screen checks it), but an explicit empty day
// list (no scheduled digest) is always kept.
export function digestSchedule(settings: Record<string, unknown>): DigestSchedule {
  const raw = settings.pay_digest;
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = time.safeParse(s.time);
  const d = days.safeParse(s.days);
  return {
    time: t.success ? t.data : DEFAULT_DIGEST_SCHEDULE.time,
    days: d.success
      ? WEEKDAYS.filter((day) => d.data.includes(day))
      : [...DEFAULT_DIGEST_SCHEDULE.days],
  };
}

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// The firm-local date whose digest is due at `now` (a digest day, at or after the time), or null.
// The tick runs every few minutes, so a digest missed while the worker was down goes later the
// same day; a day missed entirely isn't caught up (the next digest has its queries).
export function digestDueOn(now: Date, timeZone: string, schedule: DigestSchedule): string | null {
  const today = localDateOf(now, timeZone);
  const [y = 2000, m = 1, d = 1] = today.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
  if (!weekday || !schedule.days.includes(weekday)) return null;
  const w = wallTimeOf(now, timeZone);
  return w.hour * 60 + w.minute >= minutes(schedule.time) ? today : null;
}

// The weekday of a yyyy-mm-dd date.
const weekdayOf = (day: string): Weekday =>
  WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "mon";

// When the next scheduled digest goes after `now` (docs/office-v2.md 3.8, the pay dashboard), or
// null when no day is chosen. The firm's wall time is turned into an instant on that day, so a
// digest across the clock change still goes at 09:00 local. One that's due but hasn't gone yet
// (the tick runs every few minutes) isn't "next": it's going now.
export function nextDigestAt(now: Date, timeZone: string, schedule: DigestSchedule): Date | null {
  if (schedule.days.length === 0) return null;
  const today = localDateOf(now, timeZone);
  const [hour = 0, minute = 0] = schedule.time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const day = addDays(today, i);
    if (!schedule.days.includes(weekdayOf(day))) continue;
    const [year = 2000, month = 1, date = 1] = day.split("-").map(Number);
    const at = zonedToUtc({ year, month, day: date, hour, minute }, timeZone);
    if (at > now) return at;
  }
  return null;
}

const DAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

// "at 09:00, Monday to Friday" / "at 17:30 on Monday and Thursday" / null (none scheduled).
export function scheduleWords(schedule: DigestSchedule): string | null {
  const { days: chosen } = schedule;
  if (chosen.length === 0) return null;
  if (chosen.length === 7) return `at ${schedule.time}, every day`;
  const first = WEEKDAYS.indexOf(chosen[0] ?? "mon");
  const run = chosen.every((day, i) => WEEKDAYS.indexOf(day) === first + i);
  if (run && chosen.length >= 3) {
    return `at ${schedule.time}, ${DAY_NAMES[chosen[0] ?? "mon"]} to ${DAY_NAMES[chosen.at(-1) ?? "fri"]}`;
  }
  const names = chosen.map((day) => DAY_NAMES[day]);
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `at ${schedule.time} on ${list}`;
}
