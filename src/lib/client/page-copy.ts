import type { ClientRequestStatus } from "../db/schema/client";
import { roleLabel } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";

// The words of the client's pages (Phase 36.3, 36.4; docs/screens.md "## Phase 36", "36.3 and 36.4
// screens"): plain functions, so the unit tests read each line (tests/unit/client.page-copy.test.ts).
// Golden rule 11: short sentences, buttons that say what happens, a confirmation after every
// action. No line here names a casual. The office's words are ./office-copy.ts: the client's pages
// import only this file, so they never reach the office's code.

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (at: Date, timeZone: string) => {
  const w = wallTimeOf(at, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
// "12:30–19:30".
export const timesText = (start: Date, end: Date, timeZone: string) =>
  `${clock(start, timeZone)}–${clock(end, timeZone)}`;
// "Sat 14 Nov".
export const dayText = (at: Date, timeZone: string) => dayLabel(localDateOf(at, timeZone));

// --- The client's pages ---------------------------------------------------------------------------

export const CLIENT_FRAME_WORDS = (firm: string) => `${firm} · Client`;
export const EVENTS_TITLE = "Your events";
export const eventsIntro = (firm: string) =>
  `Places you've booked with ${firm}, and how covered each is. Numbers only: we look after who works.`;
export const NO_EVENTS =
  "No events to come yet. Send a new request and it shows here once it's set up.";
export const REQUESTS_TITLE = "Your requests";
export const NO_REQUESTS = "No requests yet. Use New request, or Ask for a change on an event.";

// An event's card line: "Sat 14 Nov · from 12:30 · Demo Stadium" (and "to Sun 15 Nov" when its
// sessions run over more than one day).
export function eventWhenLine(
  e: { startsAt: Date; site: string | null; sessions: { startsAt: Date }[] },
  timeZone: string,
): string {
  const first = localDateOf(e.startsAt, timeZone);
  const last = e.sessions.reduce((d, s) => {
    const day = localDateOf(s.startsAt, timeZone);
    return day > d ? day : d;
  }, first);
  const days = last === first ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`;
  return [days, `from ${clock(e.startsAt, timeZone)}`, e.site].filter(Boolean).join(" · ");
}

// "71 of 86 booked".
export const bookedOf = (booked: number, places: number) => `${booked} of ${places} booked`;
// The cover bar's colour: red under half booked, amber short of full, green when covered.
export const coverTone = (booked: number, places: number): "urgent" | "attention" | "done" =>
  places === 0 || booked >= places ? "done" : booked * 2 < places ? "urgent" : "attention";
// The chip's tone for coverWords().
export const coverChipTone = (s: { toFill: number; offering: boolean; cancelled: boolean }) =>
  s.cancelled
    ? ("quiet" as const)
    : s.toFill === 0
      ? ("done" as const)
      : s.offering
        ? ("wait" as const)
        : ("attention" as const);

// A session in the form's list: "North Gate · SIA steward · Sat 14 Nov 12:30–19:30".
export function sessionChoiceLabel(
  s: { post: string | null; role: string; startsAt: Date; endsAt: Date },
  timeZone: string,
): string {
  return [
    s.post,
    roleLabel(s.role),
    `${dayText(s.startsAt, timeZone)} ${timesText(s.startsAt, s.endsAt, timeZone)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const CLIENT_STATUS_TONES: Record<
  ClientRequestStatus,
  "attention" | "done" | "urgent" | "wait"
> = {
  waiting: "wait",
  asked: "attention",
  accepted: "done",
  done_in_planner: "done",
  declined: "urgent",
};

// "Sent Sat 14 Nov 14:40" (or "Sent 14:40" today).
export function sentWhen(at: Date, now: Date, timeZone: string): string {
  const day = localDateOf(at, timeZone);
  return day === localDateOf(now, timeZone)
    ? `Sent ${clock(at, timeZone)}`
    : `Sent ${dayLabel(day)} ${clock(at, timeZone)}`;
}

export const waitingFor = (firm: string) => `Waiting for ${firm}`;
export const questionFrom = (firm: string) => `${firm} asks`;
export const answerFrom = (firm: string) => `${firm}'s answer`;
export const REPLY_LABEL = "Your answer";
export const REPLY_BUTTON = "Send my answer";
export const replyProblemText = (status: string): string =>
  status === "invalid"
    ? "Type your answer first."
    : status === "not_asked"
      ? "They've answered this already. Reload the page."
      : status === "not_found"
        ? "We can't find that request. Reload the page."
        : status === "logged_out" || status === "not_allowed"
          ? "You're logged out. Log in again to answer."
          : "Something went wrong. Try again.";

export const FORM_TITLE = { change: "Ask for a change", new: "New request" } as const;
export const SEND_BUTTON = (firm: string) => `Send to ${firm}`;
// The yellow box before sending (with the title, the words read as docs/screens.md's "This starts
// within 2 days. {firm} will treat it as urgent. You'll get an answer here and by email.").
export const urgentBox = (firm: string) => ({
  starts_soon: {
    title: "This starts within 2 days.",
    text: `${firm} will treat it as urgent. You'll get an answer here and by email.`,
  },
  affects_booked: {
    title: "This affects people already booked.",
    text: `${firm} will treat it as urgent. You'll get an answer here and by email.`,
  },
});
