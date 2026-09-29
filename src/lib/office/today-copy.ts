import type { QueueOfficeOfferResult } from "../offers/office-offer";
import type { CloseShiftResult } from "../roster/close";
import type { SetUrgentResult } from "../roster/urgent";
import type { TodayView, UrgentShift } from "./today";

// The Today view's words (docs/screens.md `/office/today`): short sentences, plain words.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "1 place free" / "2 of 3 places free".
export function placesText(placesLeft: number, headcount: number): string {
  if (headcount === 1) return "1 place free";
  return `${placesLeft} of ${headcount} places free`;
}

// "Wave 2 · 4 offered · 0 accepted", with the office's offers and failed sends when there are any.
export function waveText(u: UrgentShift): string {
  if (u.offered === 0 && u.failed === 0) return "No offers sent yet.";
  const parts = [
    ...(u.wave !== null ? [`Wave ${u.wave}`] : []),
    `${u.offered} offered`,
    `${u.accepted} accepted`,
    ...(u.byOffice > 0 ? [`${u.byOffice} by the office`] : []),
    ...(u.failed > 0 ? [`${u.failed} couldn't be sent`] : []),
  ];
  return parts.join(" · ");
}

const STOPPED: Record<NonNullable<UrgentShift["stopped"]>, string> = {
  no_candidates: "Offers stopped: nobody else can take it.",
  filled: "Offers stopped: it was filled.",
  started: "Offers stopped: it has started.",
  not_open: "Offers stopped: it isn't open any more.",
  not_urgent: "Offers stopped: it was marked not urgent.",
};

export const stoppedText = (u: UrgentShift) => (u.stopped ? STOPPED[u.stopped] : null);

const REQUEST_WORDS: Record<string, [string, string]> = {
  time_change: ["time change", "time changes"],
  swap: ["swap", "swaps"],
  availability: ["availability change", "availability changes"],
  general: ["question", "questions"],
  review: ["review of a refused shift", "reviews of refused shifts"],
};

// "Who worked?": people on a shift that ended, not marked as worked or not attended yet.
export const toMarkText = (n: number) =>
  n === 1 ? "1 person not marked yet." : `${n} people not marked yet.`;

// "3 requests waiting: 2 time changes, 1 swap." / "No requests waiting."
export function requestsText(requests: TodayView["requests"]): string {
  if (requests.total === 0) return "No requests waiting.";
  // Always in the same order (the database returns the kinds in any order).
  const kinds = Object.entries(REQUEST_WORDS)
    .map(([type, [one, many]]) => {
      const n = requests.byType[type as keyof TodayView["requests"]["byType"]] ?? 0;
      return n > 0 ? plural(n, one, many) : null;
    })
    .filter((k): k is string => k !== null);
  return `${plural(requests.total, "request", "requests")} waiting: ${kinds.join(", ")}.`;
}

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "You can't change shifts.",
  error: "Something went wrong. Try again.",
};

export function urgentResultText(result: SetUrgentResult | Common): string {
  switch (result.status) {
    case "marked":
      return "Marked urgent. Offers are going out.";
    case "cleared":
      return "No longer urgent. No more offers will go out.";
    case "unchanged":
      return "Already done.";
    case "not_found":
      return "We can't find that shift.";
    case "not_open":
      return "This shift can't be marked urgent now. It has started or isn't open.";
    default:
      return COMMON[result.status];
  }
}

export function closeResultText(result: CloseShiftResult | Common): string {
  switch (result.status) {
    case "closed":
      return "Marked as filled. Nobody else will be offered it.";
    case "reopened":
      return "Open again. It shows as a gap until someone takes it.";
    case "unchanged":
      return "Already done.";
    case "not_found":
      return "We can't find that shift.";
    case "not_open":
      return "This shift isn't open any more.";
    case "sheet":
      return "This shift comes from your Google Sheet. Change it there.";
    default:
      return COMMON[result.status];
  }
}

export function offerResultText(result: QueueOfficeOfferResult | Common, name: string): string {
  switch (result.status) {
    case "queued":
      return `Offer on its way to ${name}.`;
    case "already_offered":
      return `${name} has already been offered this shift.`;
    case "failed_before":
      return `The last offer to ${name} couldn't be sent, so it isn't sent again. Contact them another way.`;
    case "not_candidate":
      return `${name} can't be offered this shift now.`;
    case "not_open":
      return "This shift isn't open any more.";
    case "not_found":
      return "We can't find that shift or person.";
    default:
      return COMMON[result.status];
  }
}
