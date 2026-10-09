import { CANCEL_REASONS, OTHER_REASON } from "../portal/cancel-reasons";
import { FIRM_CHANGE_REASONS } from "../roster/firm-reasons";
import {
  ADDED_ON_SHEET,
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
} from "../roster/sheets/sync";

// Free text a person typed about a worker, which goes when the worker is erased (and, for a closed
// request, after the firm's retention.request_note_days: src/lib/gdpr/retention.ts). Fixed wording
// the app chose stays: it names nobody and says only what kind of thing happened.

// A request's typed fields: the worker's note, and the colleague they'd swap with (a name).
export const REQUEST_FREE_TEXT_KEYS = ["note", "swapWith"] as const;

// A cancellation reason the app chose (the worker's quick reasons, the office's fixed list, the
// rota sheet's words): kept as it is.
const FIXED_REASONS = new Set<string>([
  ...CANCEL_REASONS,
  OTHER_REASON,
  ...Object.values(FIRM_CHANGE_REASONS),
  ADDED_ON_SHEET,
  CANCELLED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  SITE_CHANGED_ON_SHEET,
]);

export const ERASED_REASON = "Reason deleted with the worker's details";

// What an erased worker's cancellation reason becomes: fixed wording stays; "Something else:
// <their note>" becomes "Something else"; anything else typed becomes ERASED_REASON (a cancelled
// booking must still say it had a reason). Null stays null.
export function erasedCancelReason(reason: string | null): string | null {
  if (reason === null || FIXED_REASONS.has(reason)) return reason;
  if (reason.startsWith(`${OTHER_REASON}:`)) return OTHER_REASON;
  return ERASED_REASON;
}
