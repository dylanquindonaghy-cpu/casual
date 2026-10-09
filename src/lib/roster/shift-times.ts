import { parseSheetDate, parseSheetTime } from "./sheets/parse";
import { shiftWindow } from "./shift-window";

// A shift's date and times as the office types them (a yyyy-mm-dd date, hh:mm times), in the
// firm's time zone, by the same rule as the Sheets sync and the imports (shift-window.ts): a
// finish at or before the start is the next day (a night shift); a finish equal to the start, a
// time the clocks skip, or 24 hours or more is refused.

export const isoDate = (raw: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? parseSheetDate(raw.trim()) : null;

export function timesOn(
  date: { year: number; month: number; day: number },
  start: string,
  end: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } | null {
  const s = parseSheetTime(start);
  const e = parseSheetTime(end);
  if (!s || !e) return null;
  return shiftWindow(date, s, e, timeZone);
}
