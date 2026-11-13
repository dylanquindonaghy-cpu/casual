import type { OfficeCandidate } from "../offers/office-offer";
import type { Reach } from "../offers/reach";
import { dayLabel, orList, shortDate } from "../rules/reasons";
import type { NotOfferedLicence, NotOfferedWhy } from "./not-offered";
import type { OfferPage } from "./offer-page";

// "Offer to someone" in words, the same on the offer page and in the dashboard's offer panel
// (Phase 24, 24.3): who can take it, and how each offer already sent was answered. Pure.

export type OfferResponse = NonNullable<OfferPage["offered"][number]["response"]>;

// How an offer was answered. `expired` is set when the session changed after it went (moved,
// cancelled, or changed by the planner): it never runs out by itself.
export const RESPONSE_WORDS: Record<OfferResponse, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "closed when the session changed",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

export const WHO_CAN_TAKE_IT = "Who can take it";
export const ALREADY_OFFERED = "Already offered";
export const NOBODY_ELSE = "Nobody else can be offered this session right now.";
export const NOBODY_YET = "Nobody yet.";
export const URGENT_NOTE = "This session is urgent: they get the urgent message.";

// The rule under "Who can take it", with the daily cap.
export const whoRule = (cap: number) =>
  `Only people the rules allow, who want offers, and who haven't been offered it. Unless it's urgent, not anyone offered ${cap} sessions today.`;

// "8 hours booked that week".
export function candidateLine(c: Pick<OfficeCandidate, "hoursThisWeek">): string {
  const hours = c.hoursThisWeek === 1 ? "1 hour" : `${c.hoursThisWeek} hours`;
  return `${hours} booked that week`;
}

// How the offer will reach them, and why (Phase 26.9, off-1 and off-5; src/lib/offers/reach.ts).
export function reachLine(r: Reach): string {
  switch (r.how) {
    case "push":
      return "By app notification";
    case "sms":
      return "By text: no app notifications on their phone";
    case "email":
      return r.why === "chose_email"
        ? "By email: they chose email"
        : r.why === "texts_off"
          ? "By email: they turned texts off"
          : "By email: no text account yet";
    case "none":
      return "No way to reach them";
  }
}
export const OUTSIDE_AREA = "Outside their travel area";

// "Not offered, and why" (off-2).
export const NOT_OFFERED = "Not offered, and why";
export const NOBODY_LEFT_OUT = "Everyone with the role can be offered it.";
export const notOfferedMore = (n: number) => `And ${n} more.`;
// When the rules found no card detail (Phase 37.3): the office's existing phrase
// (event-words.ts), with a capital.
export const LICENCE_FALLBACK = "A licence or card missing or out of date";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The first card the rules found, by the firm's own name for it, in the office's existing words
// ("Considered but not offered", the check lines and the licence chip; Phase 37.3, w1-03). Pure.
export function licenceWhy(l: NotOfferedLicence): string {
  const name = upperFirst(l.names[0] ?? "");
  switch (l.state) {
    case "missing":
      return `Needs ${orList(l.names)} (none on file)`;
    case "out_of_date":
      return l.date ? `${name} out of date (${shortDate(l.date, l.year)})` : `${name} out of date`;
    case "runs_out":
      // The year too when the card runs out in another year than the session's (as "out of
      // date" does).
      return l.date
        ? `${name} runs out ${dayLabel(l.date)}${Number(l.date.slice(0, 4)) === l.year ? "" : ` ${l.date.slice(0, 4)}`}`
        : `${name} out of date`;
    case "marked_expired":
      return `${name} marked expired`;
    case "suspended":
      return `${name} suspended`;
    case "applied":
      return `${name} applied for, not counted`;
    case "over_allowance":
      return `${name} applied for, over the allowance`;
  }
}

export function notOfferedWhy(
  why: NotOfferedWhy,
  cap: number,
  licence?: NotOfferedLicence,
): string {
  switch (why) {
    case "booked":
      return "Booked on it";
    case "cancelled":
      return "Cancelled off it";
    case "offered":
      return "Already offered it";
    case "offers_off":
      return "Turned offers off";
    case "cap":
      return `Over today's ${cap} offers`;
    case "licence":
      return licence ? licenceWhy(licence) : LICENCE_FALLBACK;
    case "elsewhere":
      return "Booked elsewhere then";
    case "rest":
      return "Too soon after another session";
    case "hours":
      return "Over their weekly hours";
    case "unavailable":
      return "Marked unavailable";
    case "blocked":
      return "Blocked from the site";
    case "no_rule":
      return "No rule for the role";
    case "unreachable":
      return "No way to reach them";
    case "rules":
      return "The rules say no";
  }
}

// "1 place free", "3 places free".
export const placesFreeText = (n: number) => (n === 1 ? "1 place to fill" : `${n} places to fill`);

// Who sent it: "by the office" or "wave 2".
export const sentBy = (wave: number | null) => (wave === null ? "by the office" : `wave ${wave}`);
