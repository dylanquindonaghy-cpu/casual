import { noticeText } from "../portal/cancel-reasons";
import { roleLabel } from "../portal/format";
import { FIRM_CHANGE_REASONS } from "../roster/firm-reasons";
import { localDateOf } from "../time/zoned";
import { dayLabel } from "../rules/reasons";
import type { AcceptResult, AnswerResult, PlannerDoneResult } from "./answer";
import type { AddContactResult, SendLinkResult, SwitchContactResult } from "./contacts";
import { clock, dayText, timesText } from "./page-copy";
import type { AcceptPreview, OfficeClientRequest } from "./queue";
import { plannerTabWords } from "./words";

// The office's words for client requests and a contract's client logins (Phase 36.3, 36.4;
// docs/screens.md "## Phase 36", "36.3 and 36.4 screens"): the Client requests page's lines, "What
// accepting does", every answer's confirmation, and the client logins' confirmations. Plain
// functions, so the unit tests read each line (tests/unit/client.page-copy.test.ts). Kept apart from
// the client's own words (./page-copy.ts), which the client's pages import: those pages must never
// reach the office's code (tests/unit/ai.boundary.test.ts follows type imports too).

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// --- The office's Client requests page ------------------------------------------------------------

export const OFFICE_TITLE = "Client requests";
export const OFFICE_INTRO =
  "From your clients' logins. You accept or decline each; they see your answer.";
export const officeEmpty = (tab: string, planner: string | null): string =>
  tab === "waiting"
    ? "No client requests waiting. New ones show here, urgent first."
    : tab === "accepted"
      ? "No accepted requests yet."
      : tab === "declined"
        ? "No declined requests."
        : `Nothing to do in ${planner ?? "your planner"}.`;
export const MINE_WORDS = { mine: "My contracts", all: "All contracts" } as const;
export const NOT_FOUND_PANEL = "That request isn't here any more. Choose another from the list.";

// "From Priya Shah, Demo Stadium Ltd · Demo Rovers v Visitors FC · Sat 14 Nov 12:30–19:30".
export function fromLine(r: OfficeClientRequest, timeZone: string): string {
  const s = r.session;
  return [
    `From ${r.contactName}, ${r.contractName}`,
    s?.eventName || null,
    s ? `${dayText(s.startsAt, timeZone)} ${timesText(s.startsAt, s.endsAt, timeZone)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// A booked casual and the notice they'd get: "Ana Steward (52 hours' notice)".
const withNotice = (c: { name: string; noticeHours: number }) =>
  `${c.name} (${noticeText(c.noticeHours)})`;

export interface PreviewLine {
  label: string;
  text: string;
}

// "What accepting does", line by line, from officeClientRequestPreview()'s answer.
export function acceptLines(
  r: OfficeClientRequest,
  a: AcceptPreview,
  timeZone: string,
): PreviewLine[] {
  const what = r.session
    ? [r.session.post ?? r.session.site, roleLabel(r.session.role)].filter(Boolean).join(" ")
    : "";
  const client: PreviewLine = {
    label: "Client",
    text: `${r.contactName.split(" ")[0] ?? r.contactName} sees "Accepted" and gets an email.`,
  };
  switch (a.kind) {
    case "places": {
      const { before, after, cancels } = a.change;
      const lines: PreviewLine[] = [
        {
          label: what || "Places",
          text: `${before.places} places become ${after.places} (${after.booked} booked, ${after.toFill} to fill).`,
        },
      ];
      if (after.places > before.places) {
        lines.push({
          label: "Offers",
          text:
            a.offers === "now"
              ? `the ${plural(after.toFill, "open place goes", "open places go")} to the best eligible casuals now.`
              : a.offers === "hidden"
                ? "none yet: the session is hidden from casuals. Offers go out once you show it."
                : "none: you marked this session filled. Open it again to offer places.",
        });
      }
      if (cancels > 0) {
        lines.push({
          label: "Booked casuals",
          text: `${plural(cancels, "booking is", "bookings are")} cancelled by the firm, "${FIRM_CHANGE_REASONS.fewer_staff}": ${a.cancels.map(withNotice).join(", ")}. Each is told.`,
        });
      } else if (after.places < before.places) {
        lines.push({ label: "Booked casuals", text: "no one booked is affected: free places go." });
      }
      return [...lines, client];
    }
    case "times":
      return [
        {
          label: what || "Times",
          text: `${dayText(a.from.startsAt, timeZone)} ${timesText(a.from.startsAt, a.from.endsAt, timeZone)} becomes ${dayText(a.to.startsAt, timeZone)} ${timesText(a.to.startsAt, a.to.endsAt, timeZone)} (${a.curtailed ? "a shortening" : "a move"}).`,
        },
        {
          label: "Booked casuals",
          text:
            a.booked.length === 0
              ? "no one is booked yet."
              : `${a.booked.map(withNotice).join(", ")}. Each is told, and the rules are checked for each: if someone can't work the new times, nothing changes.`,
        },
        client,
      ];
    case "cancel":
      return [
        { label: what || "Session", text: "the session is cancelled." },
        {
          label: "Booked casuals",
          text:
            a.booked.length === 0
              ? "no one is booked."
              : `${plural(a.booked.length, "booking is", "bookings are")} cancelled by the firm with notice: ${a.booked.map(withNotice).join(", ")}. Each is told.`,
        },
        client,
      ];
    case "new_event":
      return [
        {
          label: "New event",
          text: `${a.name}, ${"siteId" in a.venue ? a.venue.name : `${a.venue.address} (an address: choose one of the contract's venues to make it at)`}.`,
        },
        ...a.sessions.map((s, i) => ({
          label: `Session ${i + 1}`,
          text: `${roleLabel(s.role)}, ${plural(s.places, "place", "places")}, ${dayText(s.startsAt, timeZone)} ${timesText(s.startsAt, s.endsAt, timeZone)}${s.instructions ? ` · ${s.instructions}` : ""}.`,
        })),
        { label: "Casuals", text: "the event is hidden from casuals until you show it." },
        ...(a.problems.some((p) => p === "bad_time" || p === "in_past" || p === "bad_venue")
          ? [
              {
                label: "Check first",
                text: a.problems.includes("bad_venue")
                  ? "its venue isn't the contract's any more. Choose one below, or ask the client."
                  : "some of its times have passed or don't make a session. Decline it, or ask the client.",
              },
            ]
          : []),
        client,
      ];
    case "planner":
      return [
        {
          label: "Planner",
          text: `this session comes from ${a.owner === "sheet" ? "your rota sheet" : (a.plannerName ?? "your planner")}, so nothing changes here. "${plannerTabWords(a.owner === "sheet" ? "your rota sheet" : a.plannerName)}" lists it until you mark it done.`,
        },
        client,
      ];
    case "other":
      return [
        { label: "Nothing changes by itself", text: "do what they asked, then accept it." },
        client,
      ];
    case "gone":
      return [
        {
          label: "Can't change it",
          text:
            a.why === "cancelled"
              ? "the session was cancelled. Decline it, or ask the client."
              : a.why === "started"
                ? "the session has started. Decline it, or ask the client."
                : "the session isn't there any more. Decline it, or ask the client.",
        },
      ];
  }
}

// The main button's words.
export function acceptButton(a: AcceptPreview): string {
  if (a.kind === "places" && a.change.after.places > a.change.before.places && a.offers === "now")
    return "Accept and offer the places";
  if (a.kind === "planner") return "Accept: to do in the planner";
  if (a.kind === "new_event") return "Accept and make the event";
  if (a.kind === "cancel") return "Accept and cancel the session";
  return "Accept";
}

export const DECLINE_LABEL = "Why? The client sees this.";
export const ASK_LABEL = "Your question for the client";

export function acceptResultText(r: AcceptResult | { status: "logged_out" | "error" }): string {
  switch (r.status) {
    case "accepted": {
      const a = r.applied;
      switch (a.kind) {
        case "more_places":
          return `Accepted. ${a.from} places are now ${a.to}${a.offers === "offering" || a.offers === "already_offering" ? ", and offers are going out" : a.offers === "offering_hidden" ? ". Offers go out once the session shows to casuals" : a.offers === "closed" ? ". It stays marked filled" : ""}. The client is told.`;
        case "fewer_places":
          return `Accepted. ${a.from} places are now ${a.to}${a.cancelled > 0 ? `; ${plural(a.cancelled, "booking", "bookings")} cancelled with notice` : ""}. The client is told.`;
        case "new_times":
          return `Accepted. The session ${a.status === "curtailed" ? "is shorter" : "has moved"}${a.told > 0 ? `; ${plural(a.told, "casual", "casuals")} told` : ""}. The client is told.`;
        case "cancel_session":
          return `Accepted. The session is cancelled${a.bookings > 0 ? `; ${plural(a.bookings, "booking", "bookings")} cancelled with notice` : ""}. The client is told.`;
        case "new_event":
          return `Accepted. The event is made, hidden from casuals until you show it. The client is told.`;
        case "other":
          return "Accepted. The client is told.";
      }
      return "Accepted.";
    }
    case "planner":
      return "Accepted. It's on your planner's to-do list until you mark it done. The client is told.";
    case "blocked":
      return `Not changed: ${r.workers.map((w) => `${w.name} can't work the new times (${w.reasons.join(", ")})`).join("; ")}. The request still waits: decline it, or ask the client.`;
    case "invalid":
      return r.problem === "last_place"
        ? "Not changed: that leaves no places. Decline it, or ask them to cancel the session."
        : r.problem === "choose"
          ? "Choose exactly as many bookings to cancel as the cut needs."
          : r.problem === "too_many_places"
            ? "Not changed: a session can have at most 1,000 places."
            : r.problem === "venue"
              ? "Choose one of the contract's venues to make the event at."
              : r.problem === "times"
                ? "Not changed: the new times have passed or don't make a session."
                : r.problem === "new_event"
                  ? "Not changed: the event's times have passed or don't make sessions. Decline it, or ask the client."
                  : "Something in that isn't right. Reload the page.";
    case "not_open":
      return "Not changed: the session has started, was cancelled or is gone. Decline it, or ask the client.";
    case "already_answered":
      return "Someone has answered this already. Reload the page.";
    case "not_found":
      return "We can't find that request. Reload the page.";
    case "not_allowed":
      return "You can't answer client requests.";
    case "logged_out":
      return "You're logged out. Log in again.";
    case "error":
      return "Something went wrong. Nothing changed. Try again.";
  }
}

export function answerResultText(
  r: AnswerResult | { status: "logged_out" | "error" },
  as: "decline" | "ask",
): string {
  switch (r.status) {
    case "declined":
      return "Declined. The client sees your reason and gets an email.";
    case "asked":
      return "Sent. The client sees your question and gets an email. It waits for their answer.";
    case "invalid":
      return as === "decline" ? "Type a reason: the client sees it." : "Type your question.";
    case "already_answered":
      return "Someone has answered this already. Reload the page.";
    case "not_found":
      return "We can't find that request. Reload the page.";
    case "not_allowed":
      return "You can't answer client requests.";
    case "logged_out":
      return "You're logged out. Log in again.";
    case "error":
      return "Something went wrong. Nothing was sent. Try again.";
  }
}

export function plannerDoneText(r: PlannerDoneResult | { status: "logged_out" | "error" }): string {
  switch (r.status) {
    case "done":
      return "Marked done. It's off the to-do list.";
    case "not_to_do":
      return "It's not on the to-do list any more. Reload the page.";
    case "not_found":
      return "We can't find that request. Reload the page.";
    case "not_allowed":
      return "You can't answer client requests.";
    case "logged_out":
      return "You're logged out. Log in again.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// What the office answered, as its list shows it ("Accepted by you · Mon 09:00").
export function answeredLine(r: OfficeClientRequest, timeZone: string): string | null {
  if (!r.answeredAt) return null;
  const when = `${dayText(r.answeredAt, timeZone)} ${clock(r.answeredAt, timeZone)}`;
  const word =
    r.status === "declined"
      ? "Declined"
      : r.status === "asked"
        ? "You asked them"
        : r.plannerDoneAt
          ? "Accepted, done in the planner"
          : "Accepted";
  return `${word} · ${when}`;
}

// --- A contract's client logins (Settings → Contracts → a contract) -------------------------------

export const LOGINS_TITLE = "Client logins";
export const LOGINS_INTRO =
  "Who at the client may send requests. They log in with a link to their email, see their events' numbers, and nothing about your casuals.";
export const NO_LOGINS = "No client logins yet. Add one below.";
export const ADD_LOGIN = "Add a client login";

export function lastInText(at: Date | null, now: Date, timeZone: string): string {
  if (!at) return "not logged in yet";
  const day = localDateOf(at, timeZone);
  return day === localDateOf(now, timeZone) ? "last in today" : `last in ${dayLabel(day)}`;
}

type Common = { status: "logged_out" | "not_allowed" | "error" };
const common = (s: Common["status"]) =>
  s === "logged_out"
    ? "You're logged out. Log in again."
    : s === "not_allowed"
      ? "Only admins can change client logins."
      : "Something went wrong. Nothing changed. Try again.";

export function addContactText(r: AddContactResult | Common, name: string): string {
  switch (r.status) {
    case "added":
      return `Added ${name}. Send them a link so they can log in.`;
    case "invalid":
      return r.problem === "name"
        ? "Type their name."
        : "Type their work email, like name@example.com.";
    case "email_taken":
      return "Someone already has a client login with that email.";
    case "not_found":
      return "That contract isn't there any more. Reload the page.";
    default:
      return common(r.status);
  }
}

export function switchContactText(r: SwitchContactResult | Common, name: string): string {
  switch (r.status) {
    case "switched":
      return r.on
        ? `${name} is on. Send them a link to log in.`
        : `${name} is off. They're logged out and their links don't work.`;
    case "unchanged":
      return "Nothing to change. Reload the page.";
    case "not_found":
      return "That login isn't there any more. Reload the page.";
    default:
      return common(r.status);
  }
}

export function sendLinkText(r: SendLinkResult | Common, name: string): string {
  switch (r.status) {
    case "sent":
      return `Sent. ${name} has a login link by email. It works for 15 minutes.`;
    case "off":
      return `${name} is off. Turn them on first.`;
    case "rate_limited":
      return `You've sent ${name} 3 links. Try again in ${plural(r.retryAfterMinutes, "minute", "minutes")}.`;
    case "not_found":
      return "That login isn't there any more. Reload the page.";
    default:
      return common(r.status);
  }
}
