import { roleLabel } from "../portal/format";
import { noticeText } from "../portal/cancel-reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { dayShort } from "./dashboard-map-copy";
import type { OfferOpenPlacesResult } from "./event-offers";
import type { LastCancel, OpenPlace, PlaceState, StaffingRole } from "./event-staffing";

// An event's page, round 8, in words (Phase 26.5; docs/screens.md "An event's page, round 8").
// Plain functions with no database code, so the page's own parts and the tests read every line.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (at: Date, tz: string) => {
  const w = wallTimeOf(at, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
const dayMonth = (at: Date, tz: string) => {
  const day = localDateOf(at, tz);
  return `${dayShort(day)} ${MONTHS[Number(day.split("-")[1]) - 1]}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The tabs (`?tab=`): Staffing first (the page's point), then the list as it was (Overview), the
// event's cancellations and its history. "Interested" comes with casuals asking (Phase 26.6).
export const EVENT_TABS = ["staffing", "overview", "cancellations", "history"] as const;
export type EventTab = (typeof EVENT_TABS)[number];
export const EVENT_TAB_WORDS: Record<EventTab, string> = {
  staffing: "Staffing",
  overview: "Overview",
  cancellations: "Cancellations",
  history: "History",
};
export const eventTabHref = (eventId: string, tab: EventTab) =>
  tab === "staffing" ? `/office/events/${eventId}` : `/office/events/${eventId}?tab=${tab}`;

export const BREADCRUMB = ["Dashboard", "Events & sessions"] as const;

// "Sat 7 Nov · Exampleton, ZZ1 1AA · 23 sessions" (the venue's town and postcode, else its name).
export function eventLine(
  first: Date,
  last: Date,
  venue: { name: string; town: string | null; postcode: string | null } | null,
  sessions: number,
  tz: string,
): string {
  const days =
    localDateOf(first, tz) === localDateOf(last, tz)
      ? dayMonth(first, tz)
      : `${dayMonth(first, tz)} to ${dayMonth(last, tz)}`;
  const where = venue
    ? [venue.town, venue.postcode].filter(Boolean).join(", ") || venue.name
    : null;
  return [days, where, plural(sessions, "session", "sessions")].filter(Boolean).join(" · ");
}

export const SHOWING_CHIP = { on: "Showing to casuals", off: "Hidden from casuals" } as const;
export const showButton = (showing: boolean) => (showing ? "Hide from casuals" : "Show to casuals");
export const ADD_SHIFTS = "Add shifts";
export const offerOpenPlacesButton = (n: number) =>
  `Offer ${plural(n, "open place", "open places")}`;
export const OFFER_OPEN_CONFIRM =
  "Each session with a place free is marked urgent: offers go to the best people for it, a few at a time, until it's filled. Nothing goes out while a session is hidden from casuals.";
export const OFFER_OPEN_YES = "Yes, offer them";
export const KEEP_AS_IS = "Keep as it is";
export function offerOpenResultText(
  r: OfferOpenPlacesResult | { status: "logged_out" | "error" },
): string {
  switch (r.status) {
    case "offered": {
      const going =
        r.sessions > 0
          ? `Offers are going out for ${plural(r.sessions, "session", "sessions")}.`
          : "";
      const hidden =
        r.hidden > 0
          ? `${plural(r.hidden, "session is", "sessions are")} hidden from casuals: no offers go out while hidden.`
          : "";
      return [going, hidden].filter(Boolean).join(" ");
    }
    case "none":
      return "Every open place is already being offered.";
    case "not_found":
      return "This event isn't there any more.";
    case "not_allowed":
      return "You can't offer shifts.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// "Amira Zaidi" → "Amira Z.".
export const shortName = (name: string) => {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0)}.` : first;
};
// "Amira Zaidi" → "AZ".
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

// --- The staffing layout ---
export const STAFFING_TITLE = "Staffing layout";
export const toFillChip = (n: number) => `${n} to fill`;
export const STAFFING_BOOKED = "booked";
// "Door supervisors".
export const rolePlural = (role: string) => `${roleLabel(role)}s`;
// "SIA door supervisor licence · 08:00 and 11:30".
export function roleLine(r: StaffingRole, tz: string): string {
  const times = r.starts.map((d) => hhmm(d, tz));
  const at =
    times.length <= 1
      ? (times[0] ?? "")
      : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
  return [r.requirements.join(", "), at].filter(Boolean).join(" · ");
}
export const timeSpan = (startsAt: Date, endsAt: Date, tz: string) =>
  `${hhmm(startsAt, tz)}–${hhmm(endsAt, tz)}`;
export const TILE_WORDS: Record<Exclude<PlaceState, "booked">, string> = {
  open: "Open",
  urgent: "Urgent",
};
// What a screen reader hears for each place (each one different on the page: aud-5).
export function tileLabel(
  p: { slot: number; state: PlaceState; worker: { name: string } | null },
  s: { role: string; startsAt: Date; endsAt: Date },
  tz: string,
): string {
  const where = `${roleLabel(s.role)}, ${hhmm(s.startsAt, tz)} to ${hhmm(s.endsAt, tz)}, place ${p.slot}`;
  if (p.worker) return `${p.worker.name}: ${where}. Open the session`;
  return `${p.state === "urgent" ? "Urgent open place" : "Open place"}: ${where}`;
}
export const LEGEND = { booked: "Booked", open: "Open", urgent: "Urgent" } as const;
export const LEGEND_HINT = "Tap a place to see who's on it or to offer it.";
export const NO_SESSIONS_TO_COME = "No sessions to come. Add shifts to lay out their places here.";

// --- Open places ---
export const OPEN_PLACES_TITLE = "Open places";
export const openPlacesLine = (open: OpenPlace[]) => {
  const places = open.reduce((n, o) => n + o.placesFree, 0);
  const urgent = open.filter((o) => o.urgent).reduce((n, o) => n + o.placesFree, 0);
  return `${places} open${urgent > 0 ? ` · ${urgent} urgent` : ""}`;
};
// "Door supervisor" / "Steward × 3".
export const openTitle = (o: OpenPlace) =>
  o.placesFree > 1 ? `${roleLabel(o.role)} × ${o.placesFree}` : roleLabel(o.role);
// "08:00–16:00 · 8 h".
export function openTimes(o: OpenPlace, tz: string): string {
  const minutes = Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60_000);
  const h = minutes / 60;
  const length = Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
  return `${dayMonth(o.startsAt, tz)}, ${timeSpan(o.startsAt, o.endsAt, tz)} · ${length}`;
}
// "5 days", "20 h", "45 min".
export function startsInWords(startsAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return plural(Math.floor(minutes / (24 * 60)), "day", "days");
}
export const OPEN_FIELDS = {
  needs: "Needs",
  startsIn: "Starts in",
  offered: "Offered",
  showing: "Showing to casuals",
} as const;
export const needsWords = (o: OpenPlace) =>
  o.requirements.length > 0 ? o.requirements.join(", ") : "Nothing extra";
export const offeredWords = (n: number) => plural(n, "casual", "casuals");
export const yesNo = (b: boolean) => (b ? "Yes" : "No");
// Why it's open: the cancellation that opened it.
export function whyOpen(c: LastCancel, tz: string): string {
  const when = `${hhmm(c.at, tz)} on ${dayMonth(c.at, tz)}`;
  if (!c.byCasual) return `The office cancelled ${c.worker}'s booking at ${when}.`;
  const strike =
    c.strike === "live"
      ? "Strike issued."
      : c.strike === "withdrawn"
        ? "Strike withdrawn."
        : "No strike.";
  return `${c.worker} cancelled this place at ${when}, with ${noticeText(c.noticeHours)}. ${strike}`;
}
// "Offer to the best 5" (the session marked urgent: offers go out a few at a time).
export const offerBestButton = (n: number | null) =>
  n === null ? "Offer to the best people" : `Offer to the best ${n}`;
export const OFFERS_GOING = "Offers are going out.";
export const PICK_SOMEONE = "Pick someone";
export const NO_OPEN_PLACES = "Every place is booked.";

// --- Cancellations and history ---
export const NO_CANCELLATIONS = "No cancellations on this event.";
export function cancellationLine(c: {
  worker: string;
  byCasual: boolean;
  noticeHours: number;
}): string {
  return c.byCasual
    ? `${c.worker} cancelled · ${noticeText(c.noticeHours)}`
    : `The office cancelled ${c.worker} · ${noticeText(c.noticeHours)}`;
}
export const cancellationWhen = (startsAt: Date, role: string, at: Date, tz: string) =>
  `${roleLabel(role)}, ${dayMonth(startsAt, tz)} ${hhmm(startsAt, tz)} · cancelled ${hhmm(at, tz)} on ${dayMonth(at, tz)}`;
export const strikeWords = (s: "live" | "withdrawn" | null) =>
  s === "live" ? "Strike issued" : s === "withdrawn" ? "Strike withdrawn" : null;
export const NO_HISTORY = "Nothing recorded yet.";
export const historyWhen = (at: Date, tz: string) => `${dayMonth(at, tz)} ${hhmm(at, tz)}`;
export const SEE_IN_LOG = "See everything in the action log";
