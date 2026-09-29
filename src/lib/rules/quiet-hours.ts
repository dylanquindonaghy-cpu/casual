import { z } from "zod";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";

// Quiet hours (docs/messaging-templates.md, "Notification policy"): per firm, default 22:00–07:00
// local time. Messages to workers wait until they end, except urgent ones when the firm lets
// urgent override them. A start equal to the end means no quiet hours. Pure functions: callers
// pass the firm's settings, time zone and now.

export interface QuietHours {
  start: string; // "22:00", local
  end: string; // "07:00", local (may be the next day)
  urgentOverride: boolean;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  start: "22:00",
  end: "07:00",
  urgentOverride: true,
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// The firm's quiet hours, field by field: times that make no sense get the default (a message job
// must never stop over a setting; the settings screen checks it), but an explicit
// `urgent_override: false` is always kept, so a firm's "no urgent messages at night" is never
// dropped because another part is wrong.
export function quietHours(settings: Record<string, unknown>): QuietHours {
  const raw = settings.quiet_hours;
  const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const start = time.safeParse(q.start);
  const end = time.safeParse(q.end);
  const times =
    start.success && end.success
      ? { start: start.data, end: end.data }
      : { start: DEFAULT_QUIET_HOURS.start, end: DEFAULT_QUIET_HOURS.end };
  return { ...times, urgentOverride: q.urgent_override !== false };
}

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// When the quiet hours end, if `now` is inside them; null if it isn't (or start equals end: none).
// Always a moment after now.
export function quietUntil(now: Date, timeZone: string, q: QuietHours): Date | null {
  const start = minutes(q.start);
  const end = minutes(q.end);
  if (start === end) return null;
  const w = wallTimeOf(now, timeZone);
  const at = w.hour * 60 + w.minute;
  const inside = start < end ? at >= start && at < end : at >= start || at < end;
  if (!inside) return null;
  const today = localDateOf(now, timeZone);
  // Over midnight and already past the start: they end tomorrow.
  const endDay = start > end && at >= start ? addDays(today, 1) : today;
  const [year = 2000, month = 1, day = 1] = endDay.split("-").map(Number);
  const [hour = 0, minute = 0] = q.end.split(":").map(Number);
  const first = zonedToUtc({ year, month, day, hour, minute }, timeZone);
  if (first.getTime() > now.getTime()) return first;
  // The night the clocks go back, an end time between 01:00 and 02:00 happens twice: the first
  // reading can already be past. The second is an hour later.
  const second = new Date(first.getTime() + 3_600_000);
  const w2 = wallTimeOf(second, timeZone);
  if (second.getTime() > now.getTime() && w2.hour === hour && w2.minute === minute) return second;
  return null; // never a time already past: that would hold a message for no time, over and over
}

export type MessageTiming = { ok: true } | { ok: false; until: Date };

export function mayMessageNow(input: {
  now: Date;
  timeZone: string;
  quiet: QuietHours;
  urgent: boolean;
}): MessageTiming {
  if (input.urgent && input.quiet.urgentOverride) return { ok: true };
  const until = quietUntil(input.now, input.timeZone, input.quiet);
  return until ? { ok: false, until } : { ok: true };
}
