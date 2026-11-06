import { EXPIRING_SOON_DAYS } from "../credentials/expiry";
import type { Qualification, QualificationStatus } from "../credentials/status";
import { addDays } from "../time/zoned";

// "The office has this in hand." (28.11; docs/screens.md "### 28.11"): the office's latest "Mark as
// sorted" for her (src/lib/office/casual-follow-up.ts, events casual.needs_sorted {type, status})
// was about this very qualification, and it still stands as it did then: the same type, the same
// status, nothing about her records of that type changed after the mark (`changedAfter`, read from
// the log by src/lib/portal/profile.ts), and, where a date says when that status began, marked on
// or after that day. So an old mark never covers a later lapse of the same kind, even where no
// date says when the status began (suspended, missing, applied, expired with no date): a
// suspension lifted and imposed again is a change after the mark. Where that isn't known, a status
// with no date is never "in hand". Pure and display only: it changes the words on her Profile,
// never what the rules engine counts (golden rule 6: an offer or booking still needs a checked
// record in date).

export interface SortedMark {
  type: string;
  status: string;
  day: string; // yyyy-mm-dd, the firm's calendar, when the office marked it
  // Whether her records of this type changed after the mark: a record of it added or updated, or
  // an upload of it sent, approved or turned down, logged after it (undefined: not known).
  changedAfter?: boolean;
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
  if (!COVERED.includes(q.status)) return false;
  // A renewal already on its way says so itself.
  if (q.status === "expiring_soon" && q.renewing) return false;
  return markCovers(q, mark);
}

// What a need is, for markCovers: a qualification (its type and status, the date that goes with
// it, and her turned-down upload's day where it was turned down), or the office's staff photo
// ({type: "photo", status: "missing" | "overdue", expiresOn: null}).
export interface CoveredNeed {
  type: string;
  status: string;
  expiresOn: string | null;
  rejected?: { sentOn: string } | null;
}

// Whether the office's "Mark as sorted" still covers this need as it stands now. Phase 29.3: one
// rule for the casual's "in hand" above and the office's "Sorted by" and "Remind all"
// (src/lib/office/casual-follow-up.ts). About this very need (the same type, the same status),
// nothing about her records of that type changed after the mark, and, where a date says when that
// status began, marked on or after that day. So a mark about a licence that expired, was renewed
// and expired again (a newer expiry), or about an earlier problem of the same type and status,
// covers nothing. Where no date says when it began, only a mark known to stand unchanged since.
// Pure.
export function markCovers(need: CoveredNeed, mark: SortedMark | null | undefined): boolean {
  if (!mark || mark.type !== need.type || mark.status !== need.status) return false;
  // Something about it changed after the mark: the mark was about how it stood before.
  if (mark.changedAfter === true) return false;
  // When this status began, where a date says: marked before then, it was about an earlier one.
  const began =
    need.status === "expired" && need.expiresOn
      ? addDays(need.expiresOn, 1)
      : need.status === "expiring_soon" && need.expiresOn
        ? addDays(need.expiresOn, -EXPIRING_SOON_DAYS)
        : need.status === "rejected" && need.rejected
          ? need.rejected.sentOn
          : null;
  // No date says when it began: only a mark known to stand unchanged since.
  if (began === null) return mark.changedAfter === false;
  return mark.day >= began;
}
