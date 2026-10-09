import { nextDay, wallTimeOf, zonedToUtc, type WallTime } from "../time/zoned";

// A shift's start and finish from its date and two clock times, in the firm's time zone: the one
// rule for the office's shift editor, the Sheets sync and every import (audit L67). A finish at or
// before the start is the next day (a night shift). Refused (null), rather than read as a shift of
// a day or more:
// - a finish equal to the start (a typo, not a 24-hour shift);
// - a start or finish that doesn't exist on the clock-change day (01:30 on the March Sunday: the
//   clocks go from 01:00 to 02:00), which would otherwise land an hour later;
// - anything that comes out at 24 hours or more (01:30 to 01:15 on the October Sunday, when
//   01:15 happens twice).

type Day = Pick<WallTime, "year" | "month" | "day">;
type Clock = Pick<WallTime, "hour" | "minute">;

const DAY_MS = 24 * 60 * 60 * 1000;

// The instant of a wall time, or null when the clocks skip it.
function existing(wall: WallTime, timeZone: string): Date | null {
  const instant = zonedToUtc(wall, timeZone);
  const back = wallTimeOf(instant, timeZone);
  const same =
    back.year === wall.year &&
    back.month === wall.month &&
    back.day === wall.day &&
    back.hour === wall.hour &&
    back.minute === wall.minute;
  return same ? instant : null;
}

export function shiftWindow(
  date: Day,
  start: Clock,
  end: Clock,
  timeZone: string,
): { startsAt: Date; endsAt: Date } | null {
  if (start.hour === end.hour && start.minute === end.minute) return null;
  const startsAt = existing({ ...date, ...start }, timeZone);
  if (!startsAt) return null;
  let endsAt = existing({ ...date, ...end }, timeZone);
  if (!endsAt || endsAt.getTime() <= startsAt.getTime()) {
    // At or before the start on the day (or skipped by the clocks that day): the next day.
    const sameDayExists = endsAt !== null;
    if (!sameDayExists && end.hour * 60 + end.minute > start.hour * 60 + start.minute) return null;
    endsAt = existing({ ...nextDay({ ...date, ...end }), ...end }, timeZone);
  }
  if (!endsAt) return null;
  const length = endsAt.getTime() - startsAt.getTime();
  return length > 0 && length < DAY_MS ? { startsAt, endsAt } : null;
}
