import { CANCEL_REASONS } from "../portal/cancel-reasons";
import type { StrikeReviewReason } from "../db/schema/strikes";

// Whether a cancellation gives the casual a strike (docs/office-v2.md 3.5; PLAN.md Legal 16).
// Pure: code decides (golden rule 1), from facts read in the cancellation's own transaction
// (src/lib/strikes/issue.ts). In order:
//   1. cancelled by the office, the planner or the rota sheet: none ("by_firm");
//      the firm has switched strikes off (strikes.enabled false, P3.4): none ("strikes_off");
//   2. notice of at least the firm's strikes.notice_hours (48), as recorded on the booking: none
//      ("enough_notice");
//   3. the office booked them (Assign, a rota sheet or a file): exempt, "rules_override" when it
//      overrode a rest or hours check, otherwise "booked_by_office". A booking with no record of
//      who made it counts as the office's: a strike needs proof the casual took the shift;
//   4. the office or the planner moved it, shortened it or changed its role, site or pay after the
//      booking: exempt ("changed_after_booking");
//   5. otherwise a strike ("issued"), flagged for a person to review when the reason was "I'm
//      unwell" or "Family or caring". The strike stands either way: the office can withdraw it.
// The cancel step's warning comes from the same function (with the reason left out: it only sets
// the flag), so what the casual is told is what happens when they confirm.

export type StrikeFacts =
  | { cancelledBy: "firm" }
  | {
      cancelledBy: "worker";
      noticeHours: number;
      thresholdHours: number;
      booking: { by: "worker" | "office"; overridden: boolean };
      changedAfterBooking: boolean;
      reason: string | null; // the stored reason; null for the warning, before one is chosen
      strikesOff?: true; // the firm gives no strikes (P3.4)
    };

export type StrikeDecision =
  | { result: "none"; code: "by_firm" | "strikes_off" | "enough_notice" }
  | { result: "exempt"; code: "booked_by_office" | "rules_override" | "changed_after_booking" }
  | { result: "strike"; code: "issued"; reviewReasons: StrikeReviewReason[] };

export type StrikeCode = StrikeDecision["code"];

const [UNWELL, , FAMILY] = CANCEL_REASONS;
const REVIEW_REASONS: Record<string, StrikeReviewReason> = {
  [UNWELL]: "unwell",
  [FAMILY]: "family_or_caring",
};

export function strikeDecision(facts: StrikeFacts): StrikeDecision {
  if (facts.cancelledBy === "firm") return { result: "none", code: "by_firm" };
  if (facts.strikesOff) return { result: "none", code: "strikes_off" };
  if (facts.noticeHours >= facts.thresholdHours) return { result: "none", code: "enough_notice" };
  if (facts.booking.by === "office") {
    return {
      result: "exempt",
      code: facts.booking.overridden ? "rules_override" : "booked_by_office",
    };
  }
  if (facts.changedAfterBooking) return { result: "exempt", code: "changed_after_booking" };
  const flagged = facts.reason ? REVIEW_REASONS[facts.reason] : undefined;
  return { result: "strike", code: "issued", reviewReasons: flagged ? [flagged] : [] };
}
