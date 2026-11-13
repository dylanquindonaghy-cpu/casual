import { noticeText } from "../portal/cancel-reasons";
import { ISSUE_LABELS } from "../portal/pay-query-kinds";
import { KIND_NAMES } from "../portal/request-kinds";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { dayShort, sessionWhen, updateLines } from "./dashboard-map-copy";
import { CHANNEL_WORDS } from "./enquiries-copy";
import { roleLabel } from "../portal/format";
import { URGENT_WORDS } from "../client/words";
import type { ClientRequestUpdate, NewCancellation, PageUpdate } from "./updates";
import type { LowCover, UpdateKind, UpdatePeriod } from "./updates-view";

// Updates in words (Phase 26.4; docs/screens.md "Updates"): the page, each update's lines and
// button, the bell and the pop-up. Plain functions, so the tests read every line.

export const UPDATES_TITLE = "Updates";
// Phase 36.2: the page's line says what it holds and what you can choose.
export const updatesLine = (mine: boolean) =>
  mine
    ? "What's happened on your contracts, newest first. Choose how far back, which event and what kind."
    : "What's happened, newest first. Choose how far back, which event and what kind.";
// The list's heading: what it holds (the period), then how many of them came in today (the
// firm's day), when any did: "Last 7 days · 2 new today" (round 8's "Clearer words", 3 Nov 2026).
export const LAST_7_DAYS = "Last 7 days";
export const newTodayWords = (n: number) => `${n} new today`;

// The filters (Phase 36.2; the approved mock-up's Updates). How far back: the buttons, and the
// list's heading for each.
export const PERIOD_TITLE = "How far back";
export const PERIOD_WORDS: Record<UpdatePeriod, string> = {
  today: "Today",
  "3": "3 days",
  "7": "7 days",
  "30": "30 days",
};
export const PERIOD_HEADINGS: Record<UpdatePeriod, string> = {
  today: "Today",
  "3": "Last 3 days",
  "7": LAST_7_DAYS,
  "30": "Last 30 days",
};
// Which event: every event, or one with something in the period.
export const EVENT_LABEL = "Which event";
export const ALL_EVENTS = "All events";
// What kind: a chip each, with its count (but Everything). Phase 36.4 adds "Client requests".
export const KIND_TITLE = "What kind";
export const KIND_WORDS: Record<UpdateKind, string> = {
  action: "Needs action",
  "client-requests": "Client requests",
  "to-fill": "Still to fill",
  cancellations: "Cancellations",
  pay: "Pay queries",
  uploads: "Uploads",
  enquiries: "Enquiries",
  everything: "Everything",
};
// What an empty list says, for each kind, over the period ("in the last 7 days", "today").
const OVER: Record<UpdatePeriod, string> = {
  today: "today",
  "3": "in the last 3 days",
  "7": "in the last 7 days",
  "30": "in the last 30 days",
};
export function nothingText(kind: UpdateKind, period: UpdatePeriod, oneEvent: boolean): string {
  const where = oneEvent ? " for this event" : "";
  switch (kind) {
    case "action":
      return oneEvent ? `Nothing needs action for this event.` : NOTHING_TO_ACT_ON;
    case "client-requests":
      return "No client requests waiting for you.";
    case "to-fill":
      return `No places still to fill in the next 48 hours${where}.`;
    case "cancellations":
      return `No cancellations ${OVER[period]}${where}.`;
    case "pay":
      return `No pay queries waiting, sent ${OVER[period]}.`;
    case "uploads":
      return `No uploads to check ${OVER[period]}.`;
    case "enquiries":
      return `No enquiries waiting for a person ${OVER[period]}.`;
    case "everything":
      return `Nothing ${OVER[period]}${where}.`;
  }
}
export const NOTHING_TO_ACT_ON =
  "Nothing needs action. Cancellations with a place open again, places still open near their start and uploads to check show here.";
export const NOTHING_AT_ALL = "Nothing in the last 7 days.";

// "Low on cover" (Phase 36.2): beside the list on a laptop, under it on a phone.
export const LOW_COVER_TITLE = "Low on cover";
export const LOW_COVER_LINE = "Events in the next 7 days, least covered first.";
export const LOW_COVER_NONE = "Every event in the next 7 days has its places booked.";
export const LOW_COVER_ALL = "All events";
// "71 of 86 places booked · 15 to fill"
export const lowCoverLine = (c: Pick<LowCover, "booked" | "needed" | "toFill">) =>
  `${c.booked} of ${plural(c.needed, "place", "places")} booked · ${c.toFill} to fill`;
// When its first session starts: "Thu 12 Nov · in 17 h" within 2 days (and soon, amber), else
// "Fri 13 Nov".
export function lowCoverWhen(
  firstStart: Date,
  now: Date,
  timeZone: string,
): { words: string; soon: boolean } {
  const date = dayWords(localDateOf(firstStart, timeZone));
  const soon = firstStart.getTime() - now.getTime() < 48 * 3_600_000;
  return { words: soon ? `${date} · ${startsIn(firstStart, now)}` : date, soon };
}
// How full its bar is, in percent (the bar is a picture of the words beside it).
export const coverPercent = (c: Pick<LowCover, "booked" | "needed">) =>
  c.needed === 0 ? 100 : Math.floor((c.booked * 100) / c.needed);
// An update new since "Mark all as seen" (read before its title).
export const NEW_WORD = "New";
export const MARK_SEEN = "Mark all as seen";
export function markSeenResultText(status: "seen" | "not_allowed" | "error"): string {
  if (status === "seen") return "Marked as seen.";
  if (status === "not_allowed") return "You can't see Updates.";
  return "Something went wrong. Try again.";
}
export const showingNewest = (n: number) => `Showing the newest ${n}.`;
export const MORE_IN_LOG = "Older updates are in the action log.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Sat 7 Nov" for a yyyy-mm-dd day.
const dayWords = (day: string) => {
  const [, m = 1] = day.split("-").map(Number);
  return `${dayShort(day)} ${MONTHS[m - 1]}`;
};

// A place taken between 18:00 and 08:00 (the firm's clock): "overnight".
export function overnight(at: Date, timeZone: string): boolean {
  const h = wallTimeOf(at, timeZone).hour;
  return h >= 18 || h < 8;
}

// "in 45 min", "in 5 h" (a place still open is listed from 48 hours before its start).
export function startsIn(startsAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.floor(minutes / 60)} h`;
}

export interface UpdateRow {
  title: string;
  line: string;
  tone: "done" | "urgent" | "attention" | "wait";
  href: string; // where it's dealt with
  action: { label: string; href: string } | null; // its button (none: the row is the link)
}

export function updateRow(u: PageUpdate, now: Date, timeZone: string): UpdateRow {
  if (u.kind === "open-soon") {
    const where = [roleLabel(u.role), u.site, sessionWhen(u.startsAt, timeZone)]
      .filter(Boolean)
      .join(", ");
    const offered =
      u.offers === 0
        ? "offered to nobody yet"
        : `offered to ${plural(u.offers, "person", "people")}`;
    return {
      title: `${plural(u.placesFree, "place", "places")} still to fill, starts ${startsIn(u.startsAt, now)}`,
      line: `${where} · ${offered}${u.urgent ? " · urgent" : ""}`,
      tone: "urgent",
      href: `/office/shifts/${u.shiftId}`,
      action: { label: "Offer the place", href: `/office/offer/${u.shiftId}` },
    };
  }
  // Phase 36.2: pay queries (admins), enquiries for a person and the app's requests waiting.
  if (u.kind === "pay-query") {
    return {
      title: `${u.worker} asked about pay: ${ISSUE_LABELS[u.issue].toLowerCase()}`,
      line: `For ${dayWords(u.workDate)} · with payroll`,
      tone: "wait",
      href: "/office/pay-queries",
      action: { label: "Open pay queries", href: "/office/pay-queries" },
    };
  }
  if (u.kind === "enquiry") {
    return {
      title: `${u.who} needs an answer`,
      line: `${CHANNEL_WORDS[u.channel]} · waiting for a person`,
      tone: "attention",
      href: `/office/enquiries/${u.messageId}`,
      action: { label: "Reply", href: `/office/enquiries/${u.messageId}` },
    };
  }
  if (u.kind === "app-request") {
    return {
      title: `${u.worker} asked: ${(KIND_NAMES[u.type] ?? "A request").toLowerCase()}`,
      line: `In the app · waiting for an answer${u.event ? ` · ${u.event}` : ""}`,
      tone: "attention",
      href: "/office/enquiries?view=app",
      action: { label: "Answer", href: "/office/enquiries?view=app" },
    };
  }
  if (u.kind === "to-mark") {
    return {
      title: `Mark who worked: ${plural(u.unmarked, "person", "people")} not marked yet`,
      line: [roleLabel(u.role), u.site, sessionWhen(u.startsAt, timeZone)]
        .filter(Boolean)
        .join(", "),
      tone: "attention",
      href: `/office/shifts/${u.shiftId}`,
      action: { label: "Mark who worked", href: `/office/shifts/${u.shiftId}?show=booked` },
    };
  }
  if (u.kind === "client-request") return clientRequestRow(u);
  const l = updateLines(u, timeZone);
  const base = { title: l.title, line: l.line, tone: l.tone, href: l.href };
  switch (u.kind) {
    case "took":
      return {
        ...base,
        line: overnight(u.at, timeZone) ? `${l.line} · overnight` : l.line,
        action: { label: "Open", href: l.href },
      };
    case "cancelled":
      return {
        ...base,
        action: u.reopened
          ? { label: "Offer the place", href: `/office/offer/${u.shiftId}` }
          : { label: "Open", href: l.href },
      };
    case "upload":
      return { ...base, action: { label: "Check", href: l.href } };
    case "no-reply":
      return { ...base, action: { label: "Open", href: l.href } };
  }
}

// A client's request (Phase 36.4): "Client request: +4 places · SIA steward · North Gate · Sat 14 Nov
// 12:30", the contract's name and where it stands, opening it on Client requests.
export const CLIENT_REQUESTS_HREF = "/office/client-requests";
export function clientRequestRow(u: ClientRequestUpdate): UpdateRow {
  const href = `${CLIENT_REQUESTS_HREF}?request=${u.requestId}`;
  const where =
    u.status === "asked"
      ? "you asked them something"
      : u.status === "done_in_planner"
        ? "accepted: still to do in your planner"
        : u.urgent
          ? URGENT_WORDS[u.urgent].toLowerCase()
          : "waiting for you";
  return {
    title: `Client request: ${u.title}`,
    line: `${u.contract} · ${where}`,
    tone: u.status === "waiting" ? (u.urgent ? "urgent" : "attention") : "wait",
    href: CLIENT_REQUESTS_HREF,
    action:
      u.status === "done_in_planner"
        ? { label: "Mark done", href }
        : u.status === "waiting"
          ? { label: "Answer", href }
          : { label: "Open", href },
  };
}

// The bell (sys-8): read with how many are new.
export const bellLabel = (n: number) =>
  n === 0 ? "Updates" : `Updates, ${n > 99 ? "99+" : n} new`;
export const bellCount = (n: number) => (n > 99 ? "99+" : String(n));

// The pop-up (upd-3) on a casual's cancellation.
export function popupLines(c: NewCancellation, timeZone: string) {
  return {
    title: `${c.worker} cancelled · ${noticeText(c.noticeHours)}`,
    line: [roleLabel(c.role), c.site, sessionWhen(c.startsAt, timeZone)].filter(Boolean).join(", "),
    offer: c.reopened ? { label: "Offer the place", href: `/office/offer/${c.shiftId}` } : null,
  };
}
export const POPUP_OPEN = "Open Updates";
export const POPUP_DISMISS = "Dismiss";

// A line for the 08:00 summary email (src/lib/office/alerts.ts): what needs action, with no casual's
// name (an inbox is a wider audience than the office's screens).
export function summaryLine(u: PageUpdate, now: Date, timeZone: string): string {
  const where = (x: { role: string; site: string | null; startsAt: Date }) =>
    [roleLabel(x.role), x.site, sessionWhen(x.startsAt, timeZone)].filter(Boolean).join(", ");
  switch (u.kind) {
    case "open-soon":
      return `${plural(u.placesFree, "place", "places")} still to fill, starts ${startsIn(u.startsAt, now)}: ${where(u)}`;
    case "cancelled":
      return `A cancellation · ${noticeText(u.noticeHours)}: ${where(u)}${u.reopened ? " (the place is open again)" : ""}`;
    case "upload":
      return u.what === "photo" ? "A staff photo to check" : "A certificate to check";
    case "took":
      return `A place taken: ${where(u)}`;
    case "no-reply":
      return `${plural(u.offers, "offer", "offers")} with no reply yet`;
    case "to-mark":
      return `${plural(u.unmarked, "person", "people")} not marked yet as worked: ${where(u)}`;
    case "client-request":
      return u.status === "done_in_planner"
        ? `A client request to do in your planner (${u.contract}): ${u.title}`
        : `A client request${u.urgent ? ", urgent" : ""} (${u.contract}): ${u.title}`;
    // Not in the summary's list (it lists what needs action), but said plainly if ever they are.
    case "pay-query":
      return "A pay query with payroll";
    case "enquiry":
      return "An enquiry waiting for a person";
    case "app-request":
      return "A request in the app waiting for an answer";
  }
}
