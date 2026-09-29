import { quietUntil, type QuietHours } from "./quiet-hours";

// Shift reminders (docs/messaging-templates.md: shift_reminder_24h, shift_reminder_2h): 24 hours
// and 2 hours before the start, to each worker booked on it. Pure functions: the reminder job
// (src/lib/reminders/send.ts) passes the booking, the firm's quiet hours and now.
//
// - 24h: due from the start minus 24 hours until the start minus 2 hours (then the 2-hour one
//   takes over). 2h: from the start minus 2 hours until the start.
// - Only for a booking made before that reminder's time: someone who books 5 hours before has just
//   seen the confirmation, so they get the 2-hour reminder only.
// - Reminders aren't urgent, so quiet hours hold them. One that couldn't go before its window
//   closes (a 2-hour reminder for a 06:00 start) is skipped instead, and the job records that. The
//   job runs every REMINDER_TICK_MINUTES, so a reminder only waits if the quiet hours end at least
//   two runs before its window closes (a run can start a little late); otherwise the next run
//   could find the window gone, with nothing recorded.

export type ReminderKind = "24h" | "2h";

const HOUR = 3_600_000;

// How far ahead the job looks for bookings: the 24-hour reminder's window opens then.
export const REMINDER_LOOKAHEAD_MS = 24 * HOUR;
// How often the reminder job looks (its cron).
export const REMINDER_TICK_MINUTES = 5;

// Which reminder's window `now` is in, if any: at most one at a time.
export function reminderWindow(
  startsAt: Date,
  now: Date,
): { kind: ReminderKind; opensAt: Date; closesAt: Date } | null {
  const start = startsAt.getTime();
  const at = now.getTime();
  if (at >= start) return null;
  if (at >= start - 2 * HOUR) {
    return { kind: "2h", opensAt: new Date(start - 2 * HOUR), closesAt: startsAt };
  }
  if (at >= start - 24 * HOUR) {
    return {
      kind: "24h",
      opensAt: new Date(start - 24 * HOUR),
      closesAt: new Date(start - 2 * HOUR),
    };
  }
  return null;
}

export type ReminderDecision =
  | { action: "send"; kind: ReminderKind }
  | { action: "wait" } // quiet hours; the next run after they end is still inside the window
  | { action: "skip"; kind: ReminderKind; reason: "quiet_hours" }
  | { action: "none" };

export function reminderDecision(input: {
  startsAt: Date;
  // When the worker was booked. Unknown: treated as long ago.
  confirmedAt: Date | null;
  now: Date;
  timeZone: string;
  quiet: QuietHours;
}): ReminderDecision {
  const window = reminderWindow(input.startsAt, input.now);
  if (!window) return { action: "none" };
  if (input.confirmedAt && input.confirmedAt.getTime() >= window.opensAt.getTime()) {
    return { action: "none" };
  }
  const until = quietUntil(input.now, input.timeZone, input.quiet);
  if (!until) return { action: "send", kind: window.kind };
  if (until.getTime() + 2 * REMINDER_TICK_MINUTES * 60_000 <= window.closesAt.getTime()) {
    return { action: "wait" };
  }
  return { action: "skip", kind: window.kind, reason: "quiet_hours" };
}
