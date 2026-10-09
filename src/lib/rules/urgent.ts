import { z } from "zod";
import { noticeHours } from "../roster/notice";

// When a gap is urgent (docs/architecture.md, "Cancel" step 3; docs/api-and-jobs.md): a place
// reopened on a shift that starts within the firm's `urgent_window_hours` (default 24). Pure
// functions; src/lib/roster/urgent.ts reads the rows and marks the shift.

export const DEFAULT_URGENT_WINDOW_HOURS = 24;
const HOUR = 3_600_000;

// The setting's shape, shared with fair rotation's settings (src/lib/roster/allocation-input.ts).
export const urgentWindowHoursSchema = z
  .number()
  .min(0)
  .max(168)
  .default(DEFAULT_URGENT_WINDOW_HOURS);
const windowSchema = z.object({ urgent_window_hours: urgentWindowHoursSchema });

// The firm's window in hours. A value that makes no sense gives the default rather than an error:
// it's read while recording a cancellation, which must never fail (the settings screen checks it).
export function urgentWindowHours(settings: Record<string, unknown>): number {
  const parsed = windowSchema.safeParse(settings);
  return parsed.success ? parsed.data.urgent_window_hours : DEFAULT_URGENT_WINDOW_HOURS;
}

// Starts after now, and no more than `windowHours` from now.
export function insideUrgentWindow(startsAt: Date, now: Date, windowHours: number): boolean {
  const ahead = startsAt.getTime() - now.getTime();
  return ahead > 0 && ahead <= windowHours * HOUR;
}

// Hours from now to the start, to 2 decimals (for the log), rounded as notice hours are.
export function hoursToStart(startsAt: Date, now: Date): number {
  return noticeHours(startsAt, now);
}
