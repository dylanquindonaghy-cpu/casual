import type { QueueOfficeOfferResult } from "../offers/office-offer";
import type { CloseShiftResult } from "../roster/close";
import type { SetUrgentResult } from "../roster/urgent";
import type { KeepResult } from "./worker-access";
import { ruleWords } from "./event-words";
import type { TodayBookingToCheck, TodaySheetIssue, UrgentOffers } from "./today";

// The dashboard's to-do words and the shift quick actions' answers (docs/screens.md `/office`):
// short sentences, plain words.

// "1 place free" / "2 of 3 places free".
export function placesText(placesLeft: number, headcount: number): string {
  if (headcount === 1) return "1 place free";
  return `${placesLeft} of ${headcount} places free`;
}

const STOPPED: Record<NonNullable<UrgentOffers["stopped"]>, string> = {
  no_candidates: "Offers stopped: nobody else can take it.",
  filled: "Offers stopped: it was filled.",
  started: "Offers stopped: it has started.",
  not_open: "Offers stopped: it isn't open any more.",
  hidden: "Offers stopped: it's hidden from casuals.",
  not_urgent: "Offers stopped: it was marked not urgent.",
  offer_limit: "Offers stopped: the most casuals for its free places were offered it.",
};

export const stoppedText = (u: Pick<UrgentOffers, "stopped">) =>
  u.stopped ? STOPPED[u.stopped] : null;

// "Who worked?": people on a shift that ended, not marked as worked or not attended yet.
export const toMarkText = (n: number) =>
  n === 1 ? "1 person not marked yet." : `${n} people not marked yet.`;

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
    case "marked_hidden":
      return "Marked urgent. It's hidden from casuals, so no offers go out while it's hidden.";
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
    case "planner":
      return "This session comes from your planner. Change it there.";
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
    case "hidden":
      return "This shift is hidden from casuals, so it can't be offered. Show it to casuals first.";
    case "not_found":
      return "We can't find that shift or person.";
    default:
      return COMMON[result.status];
  }
}

// "Bookings to check": why this booking is on the list.
export function toCheckText(b: TodayBookingToCheck): string {
  switch (b.cause) {
    case "inactive":
      return `${b.worker} is booked, but is no longer active.`;
    case "blocked":
      return `${b.worker} is booked, but is blocked.`;
    case "site_blocked":
      return `${b.worker} is booked, but is blocked from ${b.site ?? "this site"}.`;
  }
}

type KeepCommon = { status: "logged_out" } | { status: "error" };
export function keepResultText(result: KeepResult | KeepCommon, name: string): string {
  switch (result.status) {
    case "kept":
      return result.cause === "inactive" || result.cause === "blocked"
        ? `Kept. ${result.name}'s booking stays, and it won't show here again unless something changes. They can't log in and get no reminders: tell them yourself.`
        : `Kept. ${result.name}'s booking stays, and it won't show here again unless something changes.`;
    case "already":
      return `${result.name}'s booking was already kept.`;
    case "not_flagged":
      return `${result.name}'s booking doesn't need checking any more.`;
    case "not_found":
      return `${name}'s booking isn't there any more (cancelled, or the shift has started).`;
    case "not_allowed":
      return "You can't change bookings.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "error":
      return "Something went wrong. Reload the page to see if it was kept.";
  }
}

// "From your rota sheet": what the sheet asks for that the app didn't do.
const SHEET_FIELD_WORDS: Record<string, string> = {
  role: "role",
  startsAt: "start",
  endsAt: "finish",
  siteId: "site",
  status: "status",
};
const andList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export function sheetChangeText(change: NonNullable<TodaySheetIssue["change"]>): string {
  const fields = andList([...new Set(change.fields.map((f) => SHEET_FIELD_WORDS[f] ?? "details"))]);
  const asked = `Your rota sheet changes its ${fields}`;
  switch (change.reason) {
    case "started":
      return `${asked}, but the shift has started: not changed here.`;
    case "in_past":
      return `${asked} to a time that has already passed: not changed here. Check the date in the sheet.`;
    case "settings":
      return `${asked}, but the firm's rules settings need fixing first: not changed here.`;
    case "rules": {
      const people = change.people.map((p) => `${p.name} (${ruleWords(p.codes)})`);
      const them = people.length === 1 ? "that booking" : "those bookings";
      return `${asked}, but ${andList(people)} can't work it: not changed here. Change the sheet back, or cancel ${them} and the next sync makes the change.`;
    }
  }
}

export function sheetNameText(n: TodaySheetIssue["names"][number]): string {
  const why = n.codes.includes("no_place")
    ? "every place was taken"
    : `they couldn't be booked (${ruleWords(n.codes)}) and every place is now taken`;
  return n.dropped
    ? `${n.name} was in your rota sheet, but ${why}: taken out of the sheet.`
    : `${n.name} is in your rota sheet but isn't booked: ${ruleWords(n.codes)}. The next sync tries again.`;
}
