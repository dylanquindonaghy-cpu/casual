// Wall-clock dates and times in a firm's time zone (Europe/London) turned into UTC instants, as
// the database stores them (CLAUDE.md: UTC in the database, Europe/London on screen). No
// library: Intl knows the zone's rules.
//
// Clock changes: a time that happens twice (the October fall-back hour) is read as the first,
// earlier one; a time that doesn't exist (the March spring-forward hour) is read as the hour
// after the jump (01:30 becomes 02:30 BST).

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// The wall-clock time an instant shows in the zone.
export function wallTimeOf(instant: Date, timeZone: string): WallTime {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const asUtcMs = (w: WallTime) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);

// The zone's offset from UTC at an instant, in ms (London: 0 in winter, +1 h in summer).
function offsetAt(ms: number, timeZone: string): number {
  const floored = ms - (((ms % 60_000) + 60_000) % 60_000);
  return asUtcMs(wallTimeOf(new Date(floored), timeZone)) - floored;
}

const HALF_DAY = 12 * 60 * 60 * 1000;

export function zonedToUtc(wall: WallTime, timeZone: string): Date {
  const target = asUtcMs(wall);
  // Offsets change at most once in a day, so the offsets 12 hours either side cover both
  // readings of an ambiguous time.
  const before = offsetAt(target - HALF_DAY, timeZone);
  const after = offsetAt(target + HALF_DAY, timeZone);
  const readings = [...new Set([target - before, target - after])]
    .filter((ms) => asUtcMs(wallTimeOf(new Date(ms), timeZone)) === target)
    .sort((a, b) => a - b);
  // No reading: the time falls in the spring-forward gap. Keep the old offset, which lands just
  // after the jump.
  return new Date(readings[0] ?? target - before);
}

// The calendar day after a date (for shifts that end after midnight).
export function nextDay(wall: WallTime): WallTime {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
  return { ...wall, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");

// The calendar date an instant falls on in the zone, as yyyy-mm-dd.
export function localDateOf(instant: Date, timeZone: string): string {
  const w = wallTimeOf(instant, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

// A yyyy-mm-dd date moved by whole calendar days (negative goes back).
export function addDays(isoDate: string, days: number): string {
  const [y = 2000, m = 1, d = 1] = isoDate.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

// Midnight at the start of a calendar day (yyyy-mm-dd) in the zone, as a UTC instant. A day ends at
// the next day's midnight, 23 or 25 hours later on the days the clocks change: never add 24 hours.
export function startOfDay(isoDate: string, timeZone: string): Date {
  const [year = 2000, month = 1, day = 1] = isoDate.split("-").map(Number);
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

// The Monday of the week `day` (yyyy-mm-dd) is in.
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((weekday + 6) % 7));
}
