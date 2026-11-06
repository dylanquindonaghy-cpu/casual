import { addDays, localDateOf, mondayOf, wallTimeOf } from "../time/zoned";
import { roleLabel } from "./format";
import { dayTileName, weekRangeText, WEEK_ROWS } from "./home-copy";
import { datePartsOfDay } from "./sign-copy";

// "Your week" on Home (Phase 30.1; docs/screens.md "### 30.1"): two rows of seven day tiles, this
// week and next, Monday to Sunday on the firm's calendar. Pure: now, the firm's time zone, her
// bookings and the shifts she can take in, the tiles out.
// - A booking belongs to the day it starts (a night shift is its first day's).
// - A day is booked when one of her bookings starts on it (its tile links to that shift; the first,
//   when two start that day); otherwise it's open when a shift she can take starts on it (its tile
//   links to Open shifts for that day, `/shifts/open?day=`); otherwise it has no link.
// - Today is marked; each tile carries its name in words (colour is never the only signal).

export interface WeekBooking {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
}

export interface WeekTile {
  day: string; // yyyy-mm-dd
  dow: string; // "Mon"
  date: string; // "9"
  today: boolean;
  past: boolean;
  booked: boolean;
  open: number; // shifts she can take that start that day
  href: string | null;
  name: string; // for a screen reader
}

export interface WeekRow {
  name: (typeof WEEK_ROWS)[number];
  range: string; // "2 to 8 Nov"
  tiles: WeekTile[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: Date, timeZone: string) => {
  const w = wallTimeOf(at, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

export function homeWeek(
  now: Date,
  timeZone: string,
  bookings: readonly WeekBooking[],
  open: readonly { startsAt: Date }[],
): WeekRow[] {
  const today = localDateOf(now, timeZone);
  const monday = mondayOf(today);
  const sorted = [...bookings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const bookedOn = new Map<string, WeekBooking[]>();
  for (const b of sorted) {
    const day = localDateOf(b.startsAt, timeZone);
    bookedOn.set(day, [...(bookedOn.get(day) ?? []), b]);
  }
  const openOn = new Map<string, number>();
  for (const s of open) {
    const day = localDateOf(s.startsAt, timeZone);
    openOn.set(day, (openOn.get(day) ?? 0) + 1);
  }
  return WEEK_ROWS.map((name, w) => {
    const start = addDays(monday, w * 7);
    const tiles = Array.from({ length: 7 }, (_, i): WeekTile => {
      const day = addDays(start, i);
      const parts = datePartsOfDay(day);
      const mine = bookedOn.get(day) ?? [];
      const openCount = openOn.get(day) ?? 0;
      const first = mine[0];
      return {
        day,
        dow: parts.dow,
        date: parts.day,
        today: day === today,
        past: day < today,
        booked: mine.length > 0,
        open: openCount,
        href: first ? `/shifts/${first.shiftId}` : openCount > 0 ? `/shifts/open?day=${day}` : null,
        name: dayTileName({
          long: parts.long,
          today: day === today,
          booked: mine.map(
            (b) =>
              `${roleLabel(b.role)} ${clock(b.startsAt, timeZone)} to ${clock(b.endsAt, timeZone)}`,
          ),
          open: openCount,
        }),
      };
    });
    return { name, range: weekRangeText(start, addDays(start, 6)), tiles };
  });
}
