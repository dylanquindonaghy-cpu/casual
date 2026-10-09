import type { TravelMinutes, TravelMode } from "../travel/modes";
import { postcodeDistrict } from "../travel/postcode";
import { travelModesText } from "../travel/copy";

// "Where you work" (docs/office-v2.md 4.6; 12G.1), in the casual's words. Pure, so the browser
// can use it.

export const TRAVEL_TITLE = "Where you work";
export const TRAVEL_INTRO =
  "Tell us where you start from and how long you'll travel. We'll use it to show you shifts you can get to. It can be any postcode, not only home.";

// The line about who sees what (its wording is TRAVEL_NOTICE_VERSION in travel.ts).
export function travelPrivacyText(postcode: string | null): string {
  const district = postcode ? postcodeDistrict(postcode) : null;
  return district
    ? `The office only sees your postcode district (${district}), never your full postcode.`
    : "The office only sees your postcode district (the first part, like ZZ1), never your full postcode.";
}

export const TRAVEL_MINUTE_WORDS: Record<TravelMinutes, string> = {
  30: "30 minutes",
  45: "45 minutes",
  60: "60 minutes",
  90: "90 minutes",
};

// Profile's summary: "From ZZ1 1AA · up to 45 minutes by car or public transport".
export function travelSummaryText(t: {
  set: boolean;
  postcode: string | null;
  modes: TravelMode;
  maxMinutes: TravelMinutes;
}): string {
  if (!t.set || !t.postcode) return "Not set yet.";
  return `From ${t.postcode} · up to ${t.maxMinutes} minutes by ${travelModesText(t.modes)}`;
}

export type SaveTravelOutcome =
  | {
      status:
        | "saved"
        | "unchanged"
        | "invalid"
        | "unknown_postcode"
        | "lookup_failed"
        | "lookups_off"
        | "try_again"
        | "not_active";
    }
  | { status: "logged_out" | "error" };

export function saveTravelText(r: SaveTravelOutcome): string {
  switch (r.status) {
    case "saved":
      return "Saved. This is your travel area now.";
    case "unchanged":
      return "Nothing changed.";
    case "invalid":
      return "Enter a UK postcode, like ZZ1 1AA. Then choose how you travel and for how long.";
    case "unknown_postcode":
      return "We couldn't find that postcode, so nothing was saved. Check it and try again.";
    case "lookup_failed":
      return "We couldn't check that postcode just now, so nothing was saved. Try again in a few minutes.";
    case "lookups_off":
      return "Travel areas can't be saved yet: postcode look-ups aren't switched on. Nothing was saved.";
    case "try_again":
      return "Your travel area changed while this was saving, so nothing was saved. Check it and save again.";
    case "not_active":
      return "Your account isn't active, so nothing was saved. Contact the office.";
    case "logged_out":
      return "Log in again, then try once more.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

export type RemoveTravelOutcome =
  { status: "removed" | "not_set" | "not_active" } | { status: "logged_out" | "error" };

export function removeTravelText(r: RemoveTravelOutcome): string {
  switch (r.status) {
    case "removed":
      return "Removed. We'll show you shifts wherever they are.";
    case "not_set":
      return "You haven't set a travel area.";
    case "not_active":
      return "Your account isn't active. Contact the office.";
    case "logged_out":
      return "Log in again, then try once more.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// The lists' travel area words (docs/office-v2.md 4.2, 4.3; 12G.3): Open shifts and the urgent
// board.
export const TRAVEL_PATH = "/profile/travel";

// No travel area: everything is shown, with this prompt and a link to add one.
export const AREA_PROMPT =
  "Add your home area to see how far each shift is and only see shifts you can get to.";
export const AREA_PROMPT_LINK = "Add your home area";

// Under the list: the shifts she could take that are further than she travels.
export function furtherText(further: { count: number; atLeast: boolean }, urgent = false): string {
  const kind = urgent ? "urgent shift" : "shift";
  const n = further.count;
  if (further.atLeast) return `At least ${n} more ${kind}s are further than you travel.`;
  return n === 1
    ? `1 more ${kind} is further than you travel.`
    : `${n} more ${kind}s are further than you travel.`;
}
export const FURTHER_LINK = "Change how far";
