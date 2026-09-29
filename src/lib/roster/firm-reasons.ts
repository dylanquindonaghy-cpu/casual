// Why the office cancelled, moved or shortened a shift (golden rule 12: a firm-initiated change
// always has a reason). A fixed list, so the words can go in the action log (which never holds free
// text) and the notice report can group by them. The Sheets sync uses its own fixed words
// ("Times changed on the rota sheet"). No imports: the office's forms use it in the browser too.

export const FIRM_CHANGE_REASONS = {
  event_changed: "The event's times or place changed",
  event_cancelled: "The event was cancelled",
  fewer_staff: "The client needs fewer staff",
  weather: "Weather or safety",
  other: "Another reason",
} as const;

export type FirmChangeReason = keyof typeof FIRM_CHANGE_REASONS;
export const FIRM_CHANGE_REASON_CODES = Object.keys(FIRM_CHANGE_REASONS) as [
  FirmChangeReason,
  ...FirmChangeReason[],
];

// The list's words for a reason, or null if it isn't one of them (free text never goes in the log).
export function firmReasonWords(text: string): string | null {
  return (Object.values(FIRM_CHANGE_REASONS) as string[]).includes(text) ? text : null;
}
