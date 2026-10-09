// The firm's strike settings (docs/office-v2.md 5.2; docs/data-model.md "Firm settings"), set by the
// owner with `npm run firm:settings`, stored in firms.settings.strikes beside the strikes team's
// email. Each falls back to its default when it isn't a whole number in range. Pure.
//
// - notice_hours (48): a casual's own cancellation with less notice than this is a strike. Kept
//   apart from short_notice_threshold_hours (the law's), so firm policy doesn't move when the law
//   does.
// - live_days (90): how long a strike counts.
// - keep_months (12): when the strike row is deleted (app_purge_old_strikes(), migration 0038,
//   reads the same range): never inside the 6-month tribunal time limit.

export const STRIKE_DEFAULTS = { noticeHours: 48, liveDays: 90, keepMonths: 12 } as const;
export const STRIKE_LIMITS = {
  noticeHours: { min: 1, max: 336 },
  liveDays: { min: 1, max: 365 },
  keepMonths: { min: 7, max: 72 },
} as const;

export interface StrikeSettings {
  noticeHours: number;
  liveDays: number;
  keepMonths: number;
}

function whole(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= limits.min &&
    value <= limits.max
    ? value
    : fallback;
}

export function strikeSettings(settings: Record<string, unknown>): StrikeSettings {
  const raw = settings.strikes;
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    noticeHours: whole(s.notice_hours, STRIKE_LIMITS.noticeHours, STRIKE_DEFAULTS.noticeHours),
    liveDays: whole(s.live_days, STRIKE_LIMITS.liveDays, STRIKE_DEFAULTS.liveDays),
    keepMonths: whole(s.keep_months, STRIKE_LIMITS.keepMonths, STRIKE_DEFAULTS.keepMonths),
  };
}
