// Notice given for a cancellation: hours from the cancellation to the shift's start, to two
// decimals, as stored in assignments.notice_hours (numeric(8,2)) and shown in the notice report.
// Negative when cancelled after the start. Rounds half away from zero, like Postgres numeric.
// Works in whole milliseconds (0.01 h = 36,000 ms), so a half-way value is exact, not a float.
const MS_PER_HUNDREDTH_HOUR = 36_000;

export function noticeHours(startsAt: Date, cancelledAt: Date): number {
  const ms = startsAt.getTime() - cancelledAt.getTime();
  const hundredths = Math.sign(ms) * Math.round(Math.abs(ms) / MS_PER_HUNDREDTH_HOUR);
  return hundredths === 0 ? 0 : hundredths / 100; // never -0
}
