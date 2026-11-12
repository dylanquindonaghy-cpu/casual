import type { ClientRequestKind, ClientRequestStatus } from "../db/schema/client";
import { roleLabel } from "../portal/format";
import { dayLabel } from "../rules/reasons";
import { sessionWhen } from "../office/dashboard-map-copy";
import type { ClientPayload } from "./payloads";
import type { UrgentWhy } from "./urgency";

// Client logins and client requests in words (Phase 36.3, 36.4; docs/screens.md "## Phase 36").
// Plain functions, so the tests read every line and the client's pages, the office's pages, the
// emails and Updates say the same thing. No casual is ever named here: a client sees numbers only.

// What the client picks under "What do you need?" (the mock-up's order).
export const KIND_WORDS: Record<ClientRequestKind, string> = {
  new_event: "A new event",
  more_places: "More places on a session",
  fewer_places: "Fewer places",
  new_times: "Different times",
  cancel_session: "Cancel a session",
  other: "Something else",
};

// A request's status as the client sees it. A planner's session the office accepted reads as
// accepted: what's left is the firm's own work.
export const CLIENT_STATUS_WORDS: Record<ClientRequestStatus, string> = {
  waiting: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  asked: "Question for you",
  done_in_planner: "Accepted",
};

// The office's tabs on Client requests (the mock-up): waiting, accepted, declined, and the planner's
// to-do list, named after the planner ("To do in AXLR8"; "To do in your planner" with no name).
export const OFFICE_TABS = ["waiting", "accepted", "declined", "planner"] as const;
export type OfficeTab = (typeof OFFICE_TABS)[number];
export const plannerTabWords = (planner: string | null) => `To do in ${planner ?? "your planner"}`;
export const OFFICE_TAB_WORDS: Record<Exclude<OfficeTab, "planner">, string> = {
  waiting: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
};

export const URGENT_WORDS: Record<UrgentWhy, string> = {
  starts_soon: "Urgent · starts within 2 days",
  affects_booked: "Urgent · casuals are booked on it",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface RequestSession {
  role: string;
  startsAt: Date;
  site: string | null;
}

// One line saying what was asked for ("+4 SIA stewards · North Gate · Sat 14 Nov 12:30"), for the
// lists, Updates, the summary and the emails.
export function requestTitle(
  r: {
    kind: ClientRequestKind;
    payload: ClientPayload[ClientRequestKind] | null;
    session: RequestSession | null;
  },
  timeZone: string,
): string {
  const where = r.session
    ? [roleLabel(r.session.role), r.session.site, sessionWhen(r.session.startsAt, timeZone)]
        .filter(Boolean)
        .join(" · ")
    : null;
  const p = r.payload as Record<string, unknown> | null;
  const n = typeof p?.places === "number" ? p.places : null;
  switch (r.kind) {
    case "new_event": {
      const e = r.payload as ClientPayload["new_event"] | null;
      if (!e) return "A new event";
      const places = e.sessions.reduce((sum, s) => sum + s.places, 0);
      return `New event: ${e.name} · ${dayLabel(e.date)} · ${plural(places, "place", "places")}`;
    }
    case "more_places":
      return `${n === null ? "More places" : `+${plural(n, "place", "places")}`}${where ? ` · ${where}` : ""}`;
    case "fewer_places":
      return `${n === null ? "Fewer places" : `${plural(n, "place", "places")} fewer`}${where ? ` · ${where}` : ""}`;
    case "new_times": {
      const t = r.payload as ClientPayload["new_times"] | null;
      const to = t ? `New times ${dayLabel(t.date)} ${t.start}–${t.end}` : "New times";
      return `${to}${where ? ` · ${where}` : ""}`;
    }
    case "cancel_session":
      return `Cancel${where ? ` · ${where}` : " a session"}`;
    case "other":
      return `Something else${where ? ` · ${where}` : ""}`;
  }
}

// The client's confirmation after "Send" (copy rule: every action ends with a confirmation).
export const sentWords = (firm: string, urgent: boolean) =>
  urgent
    ? `Sent to ${firm}. It starts soon or affects people already booked, so they'll treat it as urgent. You'll get an answer here and by email.`
    : `Sent to ${firm}. You'll get an answer here and by email.`;
export const replySentWords = (firm: string) => `Sent. ${firm} will look at your request again.`;

// What the client's form says before they send it (the mock-up's yellow box).
export const startsSoonWords = (firm: string) =>
  `This starts within 2 days. ${firm} will treat it as urgent. You'll get an answer here and by email.`;

// Counts only, on the client's pages: "15 to fill", "Covered", "Offers going out".
export function coverWords(s: { toFill: number; offering: boolean; cancelled: boolean }): string {
  if (s.cancelled) return "Cancelled";
  if (s.toFill === 0) return "Covered";
  if (s.offering) return "Offers going out";
  return `${s.toFill} to fill`;
}

// Over the limit on sending requests or replies (20 an hour each, LIMITS.clientRequestPerContact and
// .clientReplyPerContact): nothing was sent.
export const tooManyRequestsWords = (retryAfterMinutes: number) => {
  const wait =
    retryAfterMinutes < 60
      ? `${retryAfterMinutes} ${retryAfterMinutes === 1 ? "minute" : "minutes"}`
      : "an hour";
  return `Too many requests. Nothing was sent. Try again in ${wait}.`;
};
