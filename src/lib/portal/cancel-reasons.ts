// The browser-safe half of "Cancel this shift": the reasons, the notice wording and the outcome's
// shape. No database code may be imported here: the cancel button (a client component) uses this
// module, and anything it imports goes into the browser bundle (tests/unit/client-boundary.test.ts).

// The quick reasons on the cancel screen; "Something else" needs a short note.
export const CANCEL_REASONS = ["I'm unwell", "Travel problem", "Family or caring"] as const;
export const OTHER_REASON = "Something else";
export const MAX_NOTE_LENGTH = 200;

export type CancelShiftOutcome =
  | {
      status: "cancelled";
      ref: string; // the booking's reference: the first 8 characters of its id, upper case
      noticeHours: number;
      recordedAt: string; // "09:14 on Mon 2 Nov", the firm's local time
      when: string | null;
      role: string | null;
      siteName: string | null;
      signOff: string;
    }
  | { status: "started" } // too late to cancel here: the office handles it
  | { status: "not_booked" } // not (or no longer) booked on it
  | { status: "invalid_reason" }
  | { status: "logged_out" }
  | { status: "error" };

// The reason as stored: one of the quick reasons, or "Something else: <note>". Null if neither.
export function cancelReason(choice: string, note: string): string | null {
  if ((CANCEL_REASONS as readonly string[]).includes(choice)) return choice;
  const trimmed = note.trim();
  if (choice === OTHER_REASON && trimmed && trimmed.length <= MAX_NOTE_LENGTH) {
    return `${OTHER_REASON}: ${trimmed}`;
  }
  return null;
}

// "2 days' notice" (48 hours or more), "5 hours' notice", "1 hour's notice", "less than an hour's
// notice". Whole units, rounded down, so the worker is never told they gave more than they did.
export function noticeText(hours: number): string {
  if (hours < 1) return "less than an hour's notice";
  if (hours >= 48) return `${Math.floor(hours / 24)} days' notice`;
  const whole = Math.floor(hours);
  return whole === 1 ? "1 hour's notice" : `${whole} hours' notice`;
}
