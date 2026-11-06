import { EXPIRING_SOON_DAYS } from "../credentials/expiry";
import type { Qualification, QualificationStatus } from "../credentials/status";
import { addDays } from "../time/zoned";

// "The office has this in hand." (28.11; docs/screens.md "### 28.11"): the office's latest "Mark as
// sorted" for her (src/lib/office/casual-follow-up.ts, events casual.needs_sorted {type, status})
// was about this very qualification, and it still stands as it did then: the same type, the same
// status, and (where a date says when that status began) marked after it began, so an old mark
// never covers a later lapse of the same kind. Pure and display only: it changes the words on her
// Profile, never what the rules engine counts (golden rule 6: an offer or booking still needs a
// checked record in date).

export interface SortedMark {
  type: string;
  status: string;
  day: string; // yyyy-mm-dd, the firm's calendar, when the office marked it
}

// The statuses with something for her to do, which "in hand" can stand in for. Valid has nothing
// to do; being checked is the office's own to-do already.
const COVERED: readonly QualificationStatus[] = [
  "expiring_soon",
  "expired",
  "missing",
  "applied",
  "suspended",
  "rejected",
];

export function inHand(
  q: Pick<Qualification, "type" | "status" | "expiresOn" | "renewing" | "rejected">,
  mark: SortedMark | null,
): boolean {
  if (!mark || mark.type !== q.type || mark.status !== q.status) return false;
  if (!COVERED.includes(q.status)) return false;
  // A renewal already on its way says so itself.
  if (q.status === "expiring_soon" && q.renewing) return false;
  // When this status began, where a date says: marked before then, it was about an earlier one.
  const began =
    q.status === "expired" && q.expiresOn
      ? addDays(q.expiresOn, 1)
      : q.status === "expiring_soon" && q.expiresOn
        ? addDays(q.expiresOn, -EXPIRING_SOON_DAYS)
        : q.status === "rejected" && q.rejected
          ? q.rejected.sentOn
          : null;
  return began === null || mark.day >= began;
}
