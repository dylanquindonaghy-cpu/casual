import { noticeText } from "../portal/cancel-reasons";
import { wallTimeOf } from "../time/zoned";
import { sessionWhen, updateLines } from "./dashboard-map-copy";
import { roleLabel } from "../portal/format";
import type { NewCancellation, PageUpdate } from "./updates";

// Updates in words (Phase 26.4; docs/screens.md "Updates"): the page, each update's lines and
// button, the bell and the pop-up. Plain functions, so the tests read every line.

export const UPDATES_TITLE = "Updates";
export const updatesLine = (mine: boolean) =>
  mine
    ? "What's happened on your contracts in the last 7 days, newest first."
    : "What's happened in the last 7 days, newest first.";
// The list's heading: how many came in today (the firm's day).
export const TODAY = "Today";
export const todayWords = (n: number) => `${n} ${n === 1 ? "update" : "updates"} today`;
// Its two views (`?view=everything`).
export const UPDATE_VIEWS = ["action", "everything"] as const;
export type UpdateView = (typeof UPDATE_VIEWS)[number];
export const VIEW_WORDS: Record<UpdateView, string> = {
  action: "Needs action",
  everything: "Everything",
};
export const updatesHref = (v: UpdateView) =>
  v === "action" ? "/office/updates" : "/office/updates?view=everything";
export const NOTHING_TO_ACT_ON =
  "Nothing needs action. Cancellations with a place open again, places still open near their start and uploads to check show here.";
export const NOTHING_AT_ALL = "Nothing in the last 7 days.";
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
  }
}
