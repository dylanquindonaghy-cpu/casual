// How long a firm keeps what the nightly purge deletes (docs/compliance.md "Retention defaults (per
// firm, adjustable)"), from `firms.settings.retention`, set by the owner (`npm run firm:settings`;
// the app role can't change firms). The defaults are the spec's: messages 90 days, requests 12
// months. A day count outside 30 to 2190 (6 years), or anything unreadable, is the default. A hold
// (`hold_until`, a date) stops the purge deleting anything personal until the day after it: for a
// dispute or a tribunal. The database's app_purge_old_messages() reads the same settings the same
// way (migration 0034; tests/integration/gdpr.retention.test.ts holds the two together).

export const RETENTION_DEFAULTS = { messageDays: 90, requestNoteDays: 365 } as const;
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 2190;

export interface RetentionSettings {
  messageDays: number;
  requestNoteDays: number;
  holdUntil: string | null; // yyyy-mm-dd: nothing personal is purged on or before this day
}

const days = (value: unknown, fallback: number) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= RETENTION_MIN_DAYS &&
  value <= RETENTION_MAX_DAYS
    ? value
    : fallback;

const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export function retentionSettings(settings: Record<string, unknown>): RetentionSettings {
  const r = settings.retention;
  const s = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
  return {
    messageDays: days(s.message_days, RETENTION_DEFAULTS.messageDays),
    requestNoteDays: days(s.request_note_days, RETENTION_DEFAULTS.requestNoteDays),
    holdUntil: isDay(s.hold_until) ? s.hold_until : null,
  };
}

// Is the hold on today (yyyy-mm-dd, the firm's local date)?
export const onHold = (r: RetentionSettings, today: string) =>
  r.holdUntil !== null && today <= r.holdUntil;
