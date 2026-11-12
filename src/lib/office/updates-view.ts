import { addDays, localDateOf, startOfDay } from "../time/zoned";
import type { PageUpdate } from "./updates";

// Updates you can filter (Phase 36.2; docs/screens.md "## Phase 36", 36.2): how far back, which
// event and which kind, kept in the address (`?days=3&event=…&kind=cancellations`) so a link opens
// the same view; the list grouped by day; "Low on cover" in order. Plain functions with no database
// code (the types only), so the tests read every rule.

// How far back: today (since the firm's midnight), or the last 3, 7 or 30 days (as many 24 hours
// back, as "Last 7 days" always was, so the 08:00 summary's list is the same). 7 unless chosen.
export const UPDATE_PERIODS = ["today", "3", "7", "30"] as const;
export type UpdatePeriod = (typeof UPDATE_PERIODS)[number];
export const DEFAULT_PERIOD: UpdatePeriod = "7";

// The kinds, as their chips run. "action" (the default) is what needs someone now; "everything"
// is every kind. The next kind slots in here, with its test in KIND_TESTS and its words in
// updates-copy.ts KIND_WORDS ("client-requests": Phase 36.4).
export const UPDATE_KINDS = [
  "action",
  "client-requests",
  "to-fill",
  "cancellations",
  "pay",
  "uploads",
  "enquiries",
  "everything",
] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];
export const DEFAULT_KIND: UpdateKind = "action";

export interface UpdatesView {
  period: UpdatePeriod;
  eventId: string | null; // one event (its id), or every event
  kind: UpdateKind;
}
export const DEFAULT_VIEW: UpdatesView = {
  period: DEFAULT_PERIOD,
  eventId: null,
  kind: DEFAULT_KIND,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const isOneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (list as readonly string[]).includes(v);

// The address's view: anything unknown falls back to its default (a link is only ever a filter).
// `?view=everything` (the page's link before Phase 36.2) still opens Everything.
export function parseUpdatesView(
  params: Record<string, string | string[] | undefined>,
): UpdatesView {
  const days = one(params.days);
  const kind = one(params.kind);
  const event = one(params.event);
  return {
    period: isOneOf(UPDATE_PERIODS, days) ? days : DEFAULT_PERIOD,
    eventId: event && UUID.test(event) ? event.toLowerCase() : null,
    kind: isOneOf(UPDATE_KINDS, kind)
      ? kind
      : one(params.view) === "everything"
        ? "everything"
        : DEFAULT_KIND,
  };
}

// The address of a view, with only what isn't the default (the plain page is the default view).
export function updatesViewHref(view: UpdatesView): string {
  const q = new URLSearchParams();
  if (view.period !== DEFAULT_PERIOD) q.set("days", view.period);
  if (view.eventId) q.set("event", view.eventId);
  if (view.kind !== DEFAULT_KIND) q.set("kind", view.kind);
  const s = q.toString();
  return s ? `/office/updates?${s}` : "/office/updates";
}

// Where the period starts: the firm's midnight today, or that many 24 hours back.
export function periodStart(period: UpdatePeriod, now: Date, timeZone: string): Date {
  if (period === "today") return startOfDay(localDateOf(now, timeZone), timeZone);
  return new Date(now.getTime() - Number(period) * 24 * 3_600_000);
}

// Still to fill, a session waiting to be marked and offers with no reply are how things stand now,
// not something that happened: they show whatever the period, under Today.
export const isState = (u: PageUpdate): boolean =>
  u.kind === "open-soon" || u.kind === "to-mark" || u.kind === "no-reply";

// What needs someone to act now (as Updates always listed it, and the 08:00 summary lists it): a
// place still open near its start, a session to mark, an upload to check, and a casual's
// cancellation whose place is open again, and a client's request waiting for the office or to do
// in the planner (Phase 36.4; not one asked about: that waits for the client). Pay queries are payroll's and enquiries have their own
// count in the menu, so they have their own chips.
export const needsAction = (u: PageUpdate): boolean =>
  u.kind === "open-soon" ||
  u.kind === "to-mark" ||
  u.kind === "upload" ||
  (u.kind === "cancelled" && u.reopened) ||
  (u.kind === "client-request" && u.status !== "asked");

const KIND_TESTS: Record<UpdateKind, (u: PageUpdate) => boolean> = {
  action: needsAction,
  "client-requests": (u) => u.kind === "client-request",
  "to-fill": (u) => u.kind === "open-soon",
  cancellations: (u) => u.kind === "cancelled",
  pay: (u) => u.kind === "pay-query",
  uploads: (u) => u.kind === "upload",
  enquiries: (u) => u.kind === "enquiry" || u.kind === "app-request",
  everything: () => true,
};
export const inKind = (u: PageUpdate, kind: UpdateKind): boolean => KIND_TESTS[kind](u);

// The chips a person sees: pay queries for those who may see them (admins: payroll has no
// Updates), enquiries for those who may answer them; every other kind for everyone on Updates.
export function kindsFor(may: { pay: boolean; enquiries: boolean }): UpdateKind[] {
  return UPDATE_KINDS.filter(
    (k) => (k !== "pay" || may.pay) && (k !== "enquiries" || may.enquiries),
  );
}

// An item's event, when it has one (a session's; a pay query's or a request's when it names one).
export function eventOf(u: PageUpdate): { id: string; name: string } | null {
  if (!("eventId" in u) || !u.eventId) return null;
  return { id: u.eventId, name: u.event ?? "" };
}

// The events with something in the period, by name: the event filter's choices.
export function eventChoices(items: PageUpdate[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const u of items) {
    const e = eventOf(u);
    if (e && !byId.has(e.id)) byId.set(e.id, e.name);
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.id.localeCompare(b.id));
}

// The list grouped by day, in the order given (states first, then newest first): Today (with
// what stands now), Yesterday, then each day before.
export interface DayGroup {
  day: string; // yyyy-mm-dd, the firm's calendar
  label: string;
  items: PageUpdate[];
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y = 2000, m = 1, d = 1] = day.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
export function groupByDay(items: PageUpdate[], now: Date, timeZone: string): DayGroup[] {
  const today = localDateOf(now, timeZone);
  const groups = new Map<string, PageUpdate[]>();
  for (const u of items) {
    const day = isState(u) ? today : localDateOf(u.at, timeZone);
    groups.set(day, [...(groups.get(day) ?? []), u]);
  }
  return [...groups]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({ day, label: dayLabel(day, today), items: list }));
}

// "Low on cover": the events in the next LOW_COVER_DAYS with places to fill, least covered first
// (booked over needed), then the soonest, then by name; LOW_COVER_SHOWN of them.
export const LOW_COVER_DAYS = 7;
export const LOW_COVER_SHOWN = 5;
export interface LowCover {
  eventId: string;
  name: string;
  firstStart: Date; // its first session in the window
  needed: number; // places in its sessions in the window
  booked: number;
  toFill: number; // places still open in them
}
export function orderLowCover(rows: LowCover[]): LowCover[] {
  const cover = (r: LowCover) => (r.needed === 0 ? 1 : r.booked / r.needed);
  return rows
    .filter((r) => r.toFill > 0)
    .sort(
      (a, b) =>
        cover(a) - cover(b) ||
        a.firstStart.getTime() - b.firstStart.getTime() ||
        a.name.localeCompare(b.name, "en-GB") ||
        a.eventId.localeCompare(b.eventId),
    );
}
