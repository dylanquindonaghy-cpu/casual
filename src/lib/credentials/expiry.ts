// What the daily credential scan does with one credential today (docs/rules-and-credentials.md,
// "Expiry warnings"). A pure function: dates in, a decision out.
//
// - A valid credential is warned once as each of 30, 14 and 7 days before its expiry date is
//   crossed. Crossing several at once (a late import, a day the scan didn't run) sends one
//   warning, for the nearest threshold, never a burst.
// - A credential is in date on its expiry date; the day after, it is marked expired.
// - Warnings are remembered against the expiry date they were about, so a renewal (a new
//   expiry date) starts them again without anything else having to reset them.
// Only `valid` credentials with an expiry date are touched: applied, suspended and already
// expired ones, and ones that never expire, are left alone.

export const WARNING_DAYS = [30, 14, 7] as const;
export type WarningDays = (typeof WARNING_DAYS)[number];

export interface ScannedCredential {
  status: "valid" | "expired" | "applied" | "suspended";
  expiresOn: string | null; // yyyy-mm-dd
  warnedFor: string | null; // the expiry date the last warning was about
  warnedDays: number | null; // that warning's threshold
}

export type ExpiryAction =
  { kind: "warn"; days: WarningDays; daysLeft: number } | { kind: "expire" } | { kind: "none" };

const dayNumber = (isoDate: string) => {
  const [y = 0, m = 1, d = 1] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function daysUntil(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

export function expiryAction(credential: ScannedCredential, today: string): ExpiryAction {
  if (credential.status !== "valid" || credential.expiresOn === null) return { kind: "none" };
  const daysLeft = daysUntil(today, credential.expiresOn);
  if (daysLeft < 0) return { kind: "expire" };
  const crossed = WARNING_DAYS.filter((t) => daysLeft <= t);
  const nearest = crossed.at(-1);
  if (nearest === undefined) return { kind: "none" };
  const sent = credential.warnedFor === credential.expiresOn ? credential.warnedDays : null;
  if (sent !== null && sent <= nearest) return { kind: "none" };
  return { kind: "warn", days: nearest, daysLeft };
}

// The office gets its list of upcoming and recent expiries on Mondays.
export function isWeeklyListDay(today: string): boolean {
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
}
