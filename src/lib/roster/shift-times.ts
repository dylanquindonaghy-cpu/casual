import { parseSheetDate, parseSheetTime } from "./sheets/parse";
import { nextDay, zonedToUtc } from "../time/zoned";

// A shift's date and times as the office types them (a yyyy-mm-dd date, hh:mm times), in the
// firm's time zone. A finish at or before the start is the next day (a night shift).

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
  const startsAt = zonedToUtc({ ...date, ...s }, timeZone);
  let endsAt = zonedToUtc({ ...date, ...e }, timeZone);
  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt = zonedToUtc({ ...nextDay({ ...date, ...e }), ...e }, timeZone);
  }
  return { startsAt, endsAt };
}
