// Why the office cancelled, moved or shortened a shift (golden rule 12: a firm-initiated change
// always has a reason). A fixed list, so the words can go in the action log (which never holds free
// text) and the notice report can group by them. The Sheets sync uses its own fixed words
// ("Times changed on the rota sheet"). No imports: the office's forms use it in the browser too.

export const FIRM_CHANGE_REASONS = {
  event_changed: "The event's times or place changed",
  event_cancelled: "The event was cancelled",
  fewer_staff: "The client needs fewer staff",
  weather: "Weather or safety",
  // One person's booking only (Today's "Bookings to check", Phase 10): they've stopped being
  // active, or the office blocked them from the site.
  not_available: "They've left, or can't work here",
  other: "Another reason",
} as const;

export type FirmChangeReason = keyof typeof FIRM_CHANGE_REASONS;
export const FIRM_CHANGE_REASON_CODES = Object.keys(FIRM_CHANGE_REASONS) as [
  FirmChangeReason,
  ...FirmChangeReason[],
];

// Reasons that only make sense for one person's booking, not a whole shift.
export const BOOKING_ONLY_REASONS: readonly FirmChangeReason[] = ["not_available"];

// The reasons a whole shift may be cancelled, moved or shortened for (checked on the server too:
// the office's forms only offer these).
export const SHIFT_CHANGE_REASON_CODES = FIRM_CHANGE_REASON_CODES.filter(
  (code) => !BOOKING_ONLY_REASONS.includes(code),
) as [FirmChangeReason, ...FirmChangeReason[]];

// The list's words for a reason, or null if it isn't one of them (free text never goes in the log).
export function firmReasonWords(text: string): string | null {
  return (Object.values(FIRM_CHANGE_REASONS) as string[]).includes(text) ? text : null;
}
