import type { OfficeCandidate } from "../offers/office-offer";
import type { OfferPage } from "./offer-page";

// "Offer to someone" in words, the same on the offer page and in the dashboard's offer panel
// (Phase 24, 24.3): who can take it, and how each offer already sent was answered. Pure.

export type OfferResponse = NonNullable<OfferPage["offered"][number]["response"]>;

// How an offer was answered. `expired` is set when the session changed after it went (moved,
// cancelled, or changed by the planner): it never runs out by itself.
export const RESPONSE_WORDS: Record<OfferResponse, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "closed when the shift changed",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

export const WHO_CAN_TAKE_IT = "Who can take it";
export const ALREADY_OFFERED = "Already offered";
export const NOBODY_ELSE = "Nobody else can be offered this shift right now.";
export const NOBODY_YET = "Nobody yet.";
export const URGENT_NOTE = "This shift is urgent: they get the urgent message.";

// The rule under "Who can take it", with the daily cap.
export const whoRule = (cap: number) =>
  `Only people the rules allow, who want offers, and who haven't been offered it. Unless it's urgent, not anyone offered ${cap} shifts today.`;

// "8 hours booked that week · by WhatsApp".
export function candidateLine(c: Pick<OfficeCandidate, "hoursThisWeek" | "channel">): string {
  const hours = c.hoursThisWeek === 1 ? "1 hour" : `${c.hoursThisWeek} hours`;
  return `${hours} booked that week · by ${c.channel === "sms" ? "text message" : "WhatsApp"}`;
}

// "1 place free", "3 places free".
export const placesFreeText = (n: number) => (n === 1 ? "1 place free" : `${n} places free`);

// Who sent it: "by the office" or "wave 2".
export const sentBy = (wave: number | null) => (wave === null ? "by the office" : `wave ${wave}`);
