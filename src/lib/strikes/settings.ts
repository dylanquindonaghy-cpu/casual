// The firm's strike settings (docs/office-v2.md 5.2; docs/data-model.md "Firm settings"), set by the
// owner with `npm run firm:settings`, stored in firms.settings.strikes beside the strikes team's
// email. Each falls back to its default when it isn't a whole number in range. Pure.
//
// - notice_hours (48): a casual's own cancellation with less notice than this is a strike. Kept
//   apart from short_notice_threshold_hours (the law's), so firm policy doesn't move when the law
//   does.
// - live_days (90): how long a strike counts.
// - keep_months (12): when the strike row is deleted (app_purge_old_strikes(), migrations 0038 and
//   0039, reads the same range): never inside the 6-month tribunal time limit, and never before a
//   strike has stopped counting for 6 months. `firm:settings` only accepts a keep_months that
//   covers live_days plus 6 months (keepCoversLive), so every strike goes at keep_months; the
//   purge also holds back one that ended under 6 months ago, against settings edited by hand.

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

// keep_months covers live_days plus 6 months (a month counted as 28 days, the shortest), so a
// strike deleted at keep_months stopped counting more than 6 months before.
export function keepCoversLive(s: StrikeSettings): boolean {
  return (s.keepMonths - 6) * 28 >= s.liveDays;
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
