import { daysUntil } from "../credentials/expiry";
import { noticeText } from "../portal/cancel-reasons";
import { roleLabel, timeOnDay } from "../portal/format";
import { ISSUE_LABELS } from "../portal/pay-query-kinds";
import { datePartsOfDay, timeRange } from "../portal/sign-copy";
import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import type { Dashboard, Part } from "./dashboard";
import { attentionCount } from "./dashboard";
import type {
  CancelsChart,
  EventNeed,
  EventsNeedChart,
  FillChart,
  FillDay,
  GapOffers,
  GapSession,
  LicenceRow,
  LicencesChart,
  OfferRow,
  OffersWeekChart,
  OfferState,
  OfferWhy,
  PayWaitingRow,
  WaitedChart,
  WaitedItem,
  WaitedKind,
  WaitingSession,
} from "./dashboard-chart-types";
import {
  cancelledByText,
  COUNT_ERROR,
  NEEDS_HEADINGS,
  noticeChip,
  SECTION_ERROR,
  SECTIONS,
} from "./dashboard-copy";
import {
  afterRows,
  attentionText,
  focusItems,
  sortedRows,
  urgentDaysText,
  type FocusItem,
  type Row,
} from "./dashboard-home";
import { placesFilledText } from "./focus-copy";
import { toMarkText } from "./today-copy";

// The dashboard's six charts and its four count cards, as the page draws them (Phase 23, 23.4;
// docs/screens.md `/office`; the approved mock-up, docs/mockups/phase-23/): every mark with its
// value, its full name for a screen reader (`aria`: the tooltip's words, the value first), its
// tooltip, and the panel of real rows it opens; each chart's one sentence written from the data,
// its legend, its Numbers table and what it says when empty or unread. Pure: the page builds this
// on the server from the loaded dashboard, and the chart components (client) get only these plain
// words and numbers (they `import type` from here), so no row a panel doesn't show (a casual's
// own reason, a pay rate, a message's words) ever reaches the browser.
//
// Colours mean one thing everywhere (the chips' too): red urgent, amber needs you, blue waiting on
// someone else, green done, grey fine (`MarkTone`). Days are the firm's calendar days, worked out
// from yyyy-mm-dd strings (never 24-hour steps: the clocks go back on Sun 25 Oct 2026).

// --- The parts the components draw ----------------------------------------------------------------

export type MarkTone = "urgent" | "open" | "wait" | "done" | "calm";
// StatusChip's tones (src/app/ui/status-chip.tsx).
export type ChipTone = "urgent" | "attention" | "wait" | "done" | "quiet";

export interface PanelLink {
  label: string;
  href: string;
  main?: boolean; // the sky main button (an urgent place's Offer, a booking to open)
}
export interface PanelChip {
  tone: ChipTone;
  text: string;
}
// One row of a panel: what it is (its title a link when `href`), a line of facts, a count, its
// chips, and the one thing to do about it.
export interface PanelRow {
  key: string;
  title: string;
  href: string | null;
  sub: string | null;
  count: string | null;
  chips: PanelChip[];
  action: PanelLink | null;
}
export interface PanelGroup {
  label: string | null;
  rows: PanelRow[];
  more: string | null; // "Showing the first 50."
  empty: string | null; // no rows: what to say instead
}
// What a mark or a count card opens: a side panel from 1024px, a sheet from the foot on a phone.
export interface Panel {
  title: string;
  sub: string | null;
  error: string | null; // SECTION_ERROR: its part couldn't be read
  groups: PanelGroup[];
  foot: PanelLink[];
}

// A mark's tooltip: the value first, then what it is. `aria` is the two together.
export interface Tip {
  value: string;
  label: string;
}
export interface Mark {
  key: string; // unique on the page: "places-chart:2026-10-24"
  aria: string;
  tip: Tip;
  panel: Panel;
}

export interface Segment {
  tone: MarkTone;
  value: number;
}

// A column (a day or an age): its parts bottom to top, its total over it, a green tick when
// every place is filled; a button (`mark`) only when there's something behind it.
export interface Column {
  key: string;
  // "Today", "Sat"; the cancellations chart's 14 narrow columns: "S" (hidden on a phone)
  top: string | null;
  bottom: string; // "24", "Yesterday"
  now: boolean;
  dim: boolean;
  segments: Segment[];
  total: number;
  full: boolean;
  mark: Mark | null;
}
export interface ColumnsBody {
  kind: "columns";
  max: number;
  ticks: number[];
  columns: Column[];
  end: boolean; // starts scrolled to its end (today on the right)
}
export interface BarRow {
  key: string;
  name: string;
  sub: string | null;
  hidden: boolean;
  segments: Segment[];
  total: number;
  mark: Mark;
}
export interface BarsBody {
  kind: "bars";
  max: number;
  rows: BarRow[];
}
export interface ShareKey {
  key: OfferState;
  tone: MarkTone;
  label: string;
  n: number;
  pct: number;
  mark: Mark | null;
}
export interface OffersBody {
  kind: "offers";
  total: number;
  aria: string; // the share bar, for a screen reader
  keys: ShareKey[];
  waiting: BarsBody | null; // the sessions still waiting for a reply
  waitingMore: string | null;
}
export interface Dot {
  key: string;
  x: number; // 0 to 100: how far along the 8 weeks
  lane: number;
  tone: MarkTone;
  big: boolean;
  name: string | null; // written beside it (a booking after it runs out)
  mark: Mark;
}
export interface TimelineBody {
  kind: "timeline";
  lanes: number;
  ticks: { x: number; label: string; alt: boolean }[];
  dots: Dot[];
}
export type ChartBody = ColumnsBody | BarsBody | OffersBody | TimelineBody;

export interface LegendItem {
  tone: MarkTone | "tick"; // tick: the green tick
  label: string;
  round?: boolean;
}
export interface ChartTable {
  caption: string | null;
  head: string[];
  rows: string[][];
}
export interface ChartNote {
  text: string | null;
  links: { text: string; href: string }[];
}
export interface ChartCard {
  id: string; // its heading's id, where a link lands
  title: string;
  wide: boolean;
  error: boolean; // its part couldn't be read: SECTION_ERROR, and "–" with COUNT_ERROR
  take: string; // one sentence from the data
  empty: string | null; // nothing to draw: what to say instead
  legend: LegendItem[];
  body: ChartBody | null;
  tables: ChartTable[];
  hint: string | null;
  swipe: string | null; // on a phone: "Swipe for later days."
  notes: ChartNote[];
}

export type CardTone = "urgent" | "attention" | "wait" | "done";
export interface CountCard {
  key: "urgent" | "needs" | "waiting" | "sorted";
  tone: CardTone;
  label: string;
  value: string;
  caption: string;
  href: string; // where it goes without script
  panel: Panel;
}

export interface DashboardModel {
  cards: CountCard[];
  charts: ChartCard[];
}

export const CHART_IDS = {
  places: "places-chart",
  events: "events-chart",
  offers: "offers-chart",
  waited: "waited-chart",
  cancels: "cancellations-chart",
  licences: "licences-chart",
} as const;

export const CHART_TITLES = {
  places: "Places to fill, next 2 weeks",
  events: "Which events need people",
  offers: "Offers this week",
  waited: "How long things have waited",
  cancels: "Cancellations, last 2 weeks",
  licences: "Licences running out, next 8 weeks",
} as const;

// --- Words ------------------------------------------------------------------------------------

export interface ChartContext {
  timeZone: string;
  today: string; // the firm's calendar day
  now: Date;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (at: Date, tz: string) => {
  const w = wallTimeOf(at, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};
const rangeOf = (s: Date, e: Date, tz: string) => timeRange(s, e, tz).range;
const andList = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// "Today", "Tomorrow", "Saturday" (within the week ahead), else "Wed 4 Nov".
export function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  const ahead = daysUntil(today, day);
  if (ahead > 1 && ahead < 7) return datePartsOfDay(day).long.split(" ")[0] ?? dayLabel(day);
  return dayLabel(day);
}

// "at 09:12 today", "at 09:12 yesterday", "at 09:12 on Mon 19 Oct" (the firm's clock).
export function whenWords(at: Date, c: ChartContext): string {
  const day = localDateOf(at, c.timeZone);
  const time = clock(at, c.timeZone);
  if (day === c.today) return `at ${time} today`;
  if (day === addDays(c.today, -1)) return `at ${time} yesterday`;
  return `at ${time} on ${dayLabel(day)}`;
}

// A chart's scale: the top of its grid (a round number at or over the biggest value) and its
// ticks, at most four steps.
export function scale(biggest: number): { max: number; ticks: number[] } {
  const n = Math.max(1, Math.ceil(biggest));
  let step = 1;
  for (let p = 1; ; p *= 10) {
    const found = [1, 2, 4, 5].map((m) => m * p).find((s) => Math.ceil(n / s) <= 4);
    if (found) {
      step = found;
      break;
    }
  }
  const max = Math.ceil(n / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

const mark = (key: string, tip: Tip, panel: Panel): Mark => ({
  key,
  aria: `${tip.value} ${tip.label}`,
  tip,
  panel,
});

const segments = (parts: Segment[]) => parts.filter((p) => p.value > 0);

const errorCard = (id: string, title: string, wide: boolean): ChartCard => ({
  id,
  title,
  wide,
  error: true,
  take: "",
  empty: null,
  legend: [],
  body: null,
  tables: [],
  hint: null,
  swipe: null,
  notes: [],
});

const emptyCard = (
  id: string,
  title: string,
  wide: boolean,
  empty: string,
  notes: ChartNote[] = [],
): ChartCard => ({ ...errorCard(id, title, wide), error: false, empty, notes });

const showing = (rows: unknown[]) => `Showing the first ${rows.length}.`;
// A Needs attention list stopped at 50: said under its count card's list and the waiting chart.
// Never "Needs attention has them all": its own lists stop at 50 too ("50+").
const LISTS_STOP = "Some lists stop at 50, so more are waiting than shown.";

// --- Rows -------------------------------------------------------------------------------------

// How a session's offers stand, as a chip: replies to come, stopped, not offered, said no.
export function offersChip(o: GapOffers): PanelChip {
  if (o.waiting > 0) return { tone: "wait", text: `${o.waiting} waiting for a reply` };
  if (o.stopped) return { tone: "quiet", text: "Offers stopped" };
  if (o.offered === 0) return { tone: "attention", text: "Not offered yet" };
  if (o.declined > 0) return { tone: "quiet", text: `${o.declined} said no` };
  return { tone: "quiet", text: `Offered to ${plural(o.offered, "casual")}` };
}

// A session with a place free: to its page, and Offer (a hidden one can't be offered: its page
// has its switch).
export function gapRow(g: GapSession, tz: string): PanelRow {
  return {
    key: g.shiftId,
    title: `${roleLabel(g.role)}, ${g.eventName}`,
    href: `/office/shifts/${g.shiftId}`,
    sub: `${dayLabel(g.date)}, ${rangeOf(g.startsAt, g.endsAt, tz)}${g.site ? ` at ${g.site}` : ""}. ${placesFilledText(g.placesFree, g.headcount)}.`,
    count: null,
    chips: [
      ...(g.urgentGap ? [{ tone: "urgent" as const, text: "Urgent" }] : []),
      ...(g.hidden ? [{ tone: "quiet" as const, text: "Hidden from casuals" }] : []),
      offersChip(g.offers),
    ],
    action: g.hidden
      ? null
      : { label: "Offer", href: `/office/offer/${g.shiftId}`, main: g.urgentGap },
  };
}

const byNeed = (a: GapSession, b: GapSession) =>
  Number(b.urgentGap) - Number(a.urgentGap) ||
  b.placesFree - a.placesFree ||
  a.startsAt.getTime() - b.startsAt.getTime();

// The old dashboard panels' actions (Phase 21), on Needs attention's rows.
export const ROW_ACTION: Record<string, string> = {
  "to-check": "Check them",
  "from-sheet": "See them",
  "to-mark": "Mark who worked",
  expired: "See them",
  uploads: "Check",
  evidence: "See them",
  "planner-refused": "See them",
  webhook: "See it",
  enquiries: "Answer",
};

const needsRow = (r: Row): PanelRow => ({
  key: r.key,
  title: r.title,
  href: null,
  sub: r.sub,
  count: r.count,
  chips: [],
  action: { label: ROW_ACTION[r.key] ?? "Open", href: r.href },
});

const CHANNEL: Record<"whatsapp" | "sms" | "voice", string> = {
  whatsapp: "WhatsApp",
  sms: "Text",
  voice: "Voicemail",
};

// Something that needs the office, with when it came and where it's dealt with.
export function waitedRow(i: WaitedItem, tz: string): PanelRow {
  const base = { key: `${i.kind}:${i.since.getTime()}`, href: null, count: null };
  switch (i.kind) {
    case "to-mark":
      return {
        ...base,
        key: `to-mark:${i.shiftId}`,
        title: `${roleLabel(i.role)}${i.site ? ` at ${i.site}` : ""}`,
        sub: `${dayLabel(localDateOf(i.startsAt, tz))}, ${rangeOf(i.startsAt, i.endsAt, tz)}. ${toMarkText(i.unmarked)}`,
        chips: [{ tone: "attention", text: "To mark" }],
        action: { label: "Mark who worked", href: `/office/shifts/${i.shiftId}` },
      };
    case "uploads":
      return {
        ...base,
        key: `uploads:${i.uploadId}`,
        title: `${i.casual}'s ${i.upload === "photo" ? "staff photo" : (i.qualificationName ?? "certificate")}`,
        sub: `Uploaded ${timeOnDay(i.since, tz)}.`,
        chips: [{ tone: "attention", text: "Upload" }],
        action: { label: "Check", href: `/office/casuals/${i.workerId}#uploads` },
      };
    case "enquiries":
      return {
        ...base,
        key: `enquiries:${i.messageId}`,
        title:
          i.who.kind === "casual"
            ? `${i.who.name}'s message`
            : i.who.kind === "unknown"
              ? "A message from a number we don't know"
              : "A message from a withheld number",
        sub: `${CHANNEL[i.channel]}, ${timeOnDay(i.since, tz)}.`,
        chips: [{ tone: "attention", text: "Needs a person" }],
        action: { label: "Answer", href: `/office/enquiries/${i.messageId}` },
      };
    case "evidence":
      return {
        ...base,
        key: `evidence:${i.assignmentId}`,
        title: `${i.casual}'s strike record`,
        sub: `${i.stuck ? "It hasn't been emailed to the strikes team." : "It couldn't be emailed to the strikes team."} Cancelled ${timeOnDay(i.since, tz)}.`,
        chips: [{ tone: "attention", text: "Strike evidence" }],
        action: { label: "Open", href: `/office/cancellations/${i.assignmentId}` },
      };
    case "planner-refused":
      return {
        ...base,
        key: `planner-refused:${i.shiftId}`,
        title: `${roleLabel(i.role)}${i.site ? ` at ${i.site}` : ""}`,
        sub: `Your planner's change was refused ${timeOnDay(i.since, tz)}. The session is on ${dayLabel(localDateOf(i.startsAt, tz))}.`,
        chips: [{ tone: "attention", text: "Planner" }],
        action: { label: "Open", href: `/office/shifts/${i.shiftId}` },
      };
    case "webhook":
      return {
        ...base,
        key: "webhook",
        title: NEEDS_HEADINGS.webhook,
        sub: `Failing since ${timeOnDay(i.since, tz)}.`,
        chips: [{ tone: "attention", text: "Webhook" }],
        action: { label: "See it", href: "/office/needs-attention#webhook" },
      };
  }
}

// A pay query with payroll: whose, what about, when (never its details).
export const payRow = (q: PayWaitingRow, tz: string): PanelRow => ({
  key: `pay:${q.payQueryId}`,
  title: `${q.casual}: ${ISSUE_LABELS[q.issue]}`,
  href: null,
  sub: `For ${dayLabel(q.workDate)}. Sent ${timeOnDay(q.since, tz)}.`,
  count: null,
  chips: [{ tone: "wait", text: q.inDigest ? "In payroll's digest" : "With payroll" }],
  action: null,
});

// --- 1. Places to fill, the next 14 days --------------------------------------------------------

// Each day of the 14 (today first): urgent places at the baseline, the rest of the gap over them,
// a tick on a day whose every place is filled; a day with sessions opens them (and, with sessions
// to mark that day, the way to mark them: Needs attention's "Who worked?").
export function fillColumns(
  f: FillChart,
  c: ChartContext,
  toMark: { startsAt: Date }[] = [],
): Column[] {
  return f.days.map((d, i) => {
    const p = datePartsOfDay(d.date);
    const today = d.date === c.today;
    const marks = toMark.filter((t) => localDateOf(t.startsAt, c.timeZone) === d.date).length;
    const gaps = f.gaps.filter((g) => g.date === d.date).sort(byNeed);
    // From the day's own count: its sessions can sit past the rows the chart holds.
    const hidden = d.hidden > 0;
    const full = d.places > 0 && d.open === 0 && d.filled >= d.places;
    const value =
      d.open > 0
        ? `${plural(d.open, "place")} to fill.`
        : full
          ? "Every place filled."
          : d.places > 0
            ? `${d.filled} of ${d.places} filled.`
            : "No sessions.";
    const details = [
      d.urgent > 0 ? `${d.urgent} urgent` : null,
      marks > 0 ? `${marks} to mark` : null,
      d.places > 0 && (d.open > 0 || full) ? `${d.filled} of ${d.places} places filled` : null,
      hidden ? "some hidden from casuals" : null,
    ].filter(Boolean);
    const label = `${dayLabel(d.date)}${today ? ", today" : ""}${details.length > 0 ? `: ${details.join(", ")}` : ""}.`;
    return {
      key: d.date,
      top: i === 0 && today ? "Today" : p.dow,
      bottom: p.day,
      now: today,
      dim: d.places === 0,
      segments: segments([
        { tone: "urgent", value: d.urgent },
        { tone: "open", value: d.open - d.urgent },
      ]),
      total: d.open,
      full,
      mark:
        d.places > 0
          ? mark(
              `${CHART_IDS.places}:${d.date}`,
              { value, label },
              dayPanel(d, gaps, marks, c.timeZone),
            )
          : null,
    };
  });
}

// A day's panel: its sessions with places free, most needed first, with Offer; then the day's
// sessions and the rota board.
export function dayPanel(d: FillDay, gaps: GapSession[], toMark: number, tz: string): Panel {
  const day = dayLabel(d.date);
  const full = d.places > 0 && d.filled >= d.places;
  return {
    title:
      d.open > 0
        ? `${day}: ${plural(d.open, "place")} to fill`
        : full
          ? `${day}: every place is filled`
          : `${day}: nothing left to fill`,
    sub: `${d.filled} of ${d.places} places filled.${d.urgent > 0 ? ` ${d.urgent} urgent.` : ""}`,
    error: null,
    groups: [
      ...(toMark > 0
        ? [
            {
              label: "Needs you",
              rows: [
                {
                  key: "to-mark",
                  title: NEEDS_HEADINGS["to-mark"],
                  href: null,
                  sub: `${plural(toMark, "session")} to mark`,
                  count: String(toMark),
                  chips: [],
                  action: { label: "Mark who worked", href: "/office/needs-attention#to-mark" },
                },
              ],
              more: null,
              empty: null,
            },
          ]
        : []),
      {
        label: toMark > 0 ? "Places to fill" : null,
        rows: gaps.map((g) => gapRow(g, tz)),
        more:
          gaps.length < d.gapSessions
            ? gaps.length > 0
              ? showing(gaps)
              : "See this day's sessions for the list."
            : null,
        empty:
          d.gapSessions === 0
            ? full
              ? "Every place is filled."
              : "No places are left to fill: the sessions with places free have started."
            : null,
      },
    ],
    foot: [
      { label: "See this day's sessions", href: `/office/shifts?from=${d.date}` },
      { label: "Open the rota board", href: "/office/events" },
    ],
  };
}

// "Saturday needs 11 more people, 2 of them urgently. 8 places in the next 2 weeks are hidden
// from casuals." Nothing left to fill: every place filled only when every day's is (a session
// that started with places free has none left to fill, but isn't filled). The hidden places are
// the days' own counts, never only the rows the chart holds.
export function fillTake(f: FillChart, c: ChartContext): string {
  const total = f.days.reduce((n, d) => n + d.open, 0);
  if (total === 0)
    return f.days.every((d) => d.filled >= d.places)
      ? "Every place in the next 2 weeks is filled."
      : "Nothing is left to fill in the next 2 weeks.";
  const busiest = f.days.reduce((a, d) => (d.open > a.open ? d : a));
  const hidden = f.days.reduce((n, d) => n + d.hidden, 0);
  const first = `${dayName(busiest.date, c.today)} needs ${plural(busiest.open, "more person", "more people")}${busiest.urgent > 0 ? `, ${busiest.urgent} of them urgently` : ""}.`;
  if (hidden > 0)
    return `${first} ${plural(hidden, "place")} in the next 2 weeks ${hidden === 1 ? "is" : "are"} hidden from casuals.`;
  return total > busiest.open ? `${first} ${total} places to fill in all.` : first;
}

export function placesChart(
  p: Part<FillChart>,
  c: ChartContext,
  toMark: { startsAt: Date }[] = [],
): ChartCard {
  const { places: id } = CHART_IDS;
  const title = CHART_TITLES.places;
  const board = { text: null, links: [{ text: "Open the rota board", href: "/office/events" }] };
  if (!p.ok) return errorCard(id, title, true);
  const f = p.data;
  if (!f.days.some((d) => d.places > 0))
    return emptyCard(id, title, true, "No sessions in the next 2 weeks.", [board]);
  const { max, ticks } = scale(Math.max(...f.days.map((d) => d.open)));
  return {
    id,
    title,
    wide: true,
    error: false,
    take: fillTake(f, c),
    empty: null,
    legend: [
      { tone: "urgent", label: "Urgent" },
      { tone: "open", label: "To fill" },
      { tone: "tick", label: "Every place filled" },
    ],
    body: { kind: "columns", max, ticks, columns: fillColumns(f, c, toMark), end: false },
    tables: [
      {
        caption: null,
        head: ["Day", "Urgent", "To fill", "Filled", "Places"],
        rows: f.days
          .filter((d) => d.places > 0)
          .map((d) => [
            dayLabel(d.date),
            String(d.urgent),
            String(d.open - d.urgent),
            String(d.filled),
            String(d.places),
          ]),
      },
    ],
    hint: "Pick a day to see its sessions.",
    swipe: "Swipe for later days.",
    notes: [board],
  };
}

// --- 2. Which events need people ----------------------------------------------------------------

export function eventPanel(e: EventNeed, tz: string): Panel {
  const hiddenWords = !e.showing
    ? " Casuals can't see this event yet."
    : e.hiddenSessions
      ? " Some of its sessions are hidden from casuals."
      : "";
  return {
    title: `${e.name}: ${plural(e.places, "place")} to fill`,
    sub: `${e.site ? `${e.site}. ` : ""}${plural(e.gapSessions, "session")} with places free.${hiddenWords}`,
    error: null,
    groups: [
      {
        label: null,
        rows: e.sessions.map((g) => gapRow(g, tz)),
        more: e.moreSessions ? showing(e.sessions) : null,
        empty: null,
      },
    ],
    foot: [
      { label: "Open this event", href: `/office/events/${e.eventId}` },
      { label: "See every event that needs people", href: "/office/events?view=need" },
    ],
  };
}

export function eventsTake(n: EventsNeedChart): string {
  const top = n.events[0];
  if (!top) return "";
  const first = `${top.name} needs ${plural(top.places, "more person", "more people")}${top.urgent > 0 ? `, ${top.urgent} of them urgently` : ""}.`;
  // How many have gaps casuals can't see: over every event that needs people (`hiddenEvents`),
  // never only the bars. Just one, and it's a bar: named.
  if (n.hiddenEvents === 1) {
    const hidden = n.events.filter((e) => e.hidden);
    const only = hidden.length === 1 ? hidden[0] : undefined;
    if (only)
      return `${first} ${only.showing ? `Some of ${only.name}'s sessions are hidden from casuals.` : `Casuals can't see ${only.name} yet.`}`;
    return `${first} 1 event has gaps casuals can't see.`;
  }
  if (n.hiddenEvents > 1)
    return `${first} ${plural(n.hiddenEvents, "event")} have gaps casuals can't see.`;
  return n.total.events > 1
    ? `${first} ${n.total.events} events need ${plural(n.total.places, "person", "people")} in all.`
    : first;
}

export function eventsChart(p: Part<EventsNeedChart>, c: ChartContext): ChartCard {
  const { events: id } = CHART_IDS;
  const title = CHART_TITLES.events;
  if (!p.ok) return errorCard(id, title, false);
  const n = p.data;
  const fullNote: ChartNote[] =
    n.full.length > 0
      ? [
          {
            text: `${andList(n.fullMore > 0 ? [...n.full, `${n.fullMore} more`] : n.full)} ${n.full.length + n.fullMore === 1 ? "is" : "are"} full.`,
            links: [],
          },
        ]
      : [];
  // None needs people. Never "every event to come has the people it needs": an event whose
  // sessions are drafts, or whose only gap has started, is neither in the list nor full.
  if (n.events.length === 0)
    return emptyCard(id, title, false, "No event needs people right now.", fullNote);
  const { max } = scale(Math.max(...n.events.map((e) => e.places)));
  return {
    id,
    title,
    wide: false,
    error: false,
    take: eventsTake(n),
    empty: null,
    legend: [
      { tone: "urgent", label: "Urgent" },
      { tone: "open", label: "To fill" },
    ],
    body: {
      kind: "bars",
      max,
      rows: n.events.map((e) => {
        const details = [
          e.urgent > 0 ? `${e.urgent} urgent` : null,
          !e.showing
            ? "hidden from casuals"
            : e.hiddenSessions
              ? "some sessions hidden from casuals"
              : null,
        ].filter(Boolean);
        return {
          key: e.eventId,
          name: e.name,
          sub: null,
          hidden: e.hidden,
          segments: segments([
            { tone: "urgent", value: e.urgent },
            { tone: "open", value: e.places - e.urgent },
          ]),
          total: e.places,
          mark: mark(
            `${id}:${e.eventId}`,
            {
              value: `${plural(e.places, "place")} to fill.`,
              label: `${e.name}${details.length > 0 ? `: ${details.join(", ")}` : ""}.`,
            },
            eventPanel(e, c.timeZone),
          ),
        };
      }),
    },
    tables: [
      {
        caption: null,
        head: ["Event", "Urgent", "To fill", "Hidden"],
        rows: n.events.map((e) => [
          e.name,
          String(e.urgent),
          String(e.places - e.urgent),
          e.hidden ? "Yes" : "No",
        ]),
      },
    ],
    hint: "Pick an event to see the sessions with gaps.",
    swipe: null,
    notes: [
      ...fullNote,
      {
        text:
          n.more > 0
            ? `${plural(n.more, "more event")} ${n.more === 1 ? "needs" : "need"} people.`
            : null,
        links: [{ text: "See every event that needs people", href: "/office/events?view=need" }],
      },
    ],
  };
}

// --- 3. Offers this week --------------------------------------------------------------------------

const SHARE: { key: OfferState; tone: MarkTone; label: string }[] = [
  { key: "yes", tone: "done", label: "Said yes" },
  { key: "waiting", tone: "wait", label: "Waiting for a reply" },
  { key: "closed", tone: "calm", label: "Said no or closed" },
];

const WHY_CHIP: Record<OfferWhy, string> = {
  said_no: "Said no",
  filled_elsewhere: "Someone else",
  changed: "Session changed",
  no_reply: "No reply",
};
const WHY_WORDS: Record<OfferWhy, (n: number) => string> = {
  said_no: (n) => `${n} said no`,
  filled_elsewhere: (n) => `${n} went to someone else`,
  changed: (n) => `${n} closed when the session changed`,
  no_reply: (n) => `${n} had no reply before it started`,
};

// An offer: who, for what, when it went (or when they said yes), and its session (the link says
// so: the row is titled with the casual).
export function offerRow(r: OfferRow, tz: string): PanelRow {
  const when =
    r.state === "yes" && r.answeredAt
      ? `Said yes ${timeOnDay(r.answeredAt, tz)}`
      : `Sent ${timeOnDay(r.sentAt, tz)}`;
  return {
    key: r.offerId,
    title: r.casual,
    href: null,
    sub: `${roleLabel(r.role)}, ${r.eventName}. ${timeOnDay(r.startsAt, tz)}. ${when}.`,
    count: null,
    chips: [
      r.state === "yes"
        ? { tone: "done", text: "Said yes" }
        : r.state === "waiting"
          ? { tone: "wait", text: "Waiting" }
          : { tone: "quiet", text: r.why ? WHY_CHIP[r.why] : "Closed" },
    ],
    action: { label: "Open the session", href: `/office/shifts/${r.shiftId}` },
  };
}

const noticeReport = (w: OffersWeekChart, c: ChartContext): PanelLink => ({
  label: "Open the notice report",
  href: `/office/reports/notice?kind=offers&from=${w.week.monday}&to=${c.today < w.week.sunday ? c.today : w.week.sunday}`,
});

export function offersPanel(w: OffersWeekChart, state: OfferState, c: ChartContext): Panel {
  const n = w.counts[state];
  const why = (Object.keys(WHY_WORDS) as OfferWhy[])
    .filter((k) => w.closedWhy[k] > 0)
    .map((k) => WHY_WORDS[k](w.closedWhy[k]));
  return {
    title:
      state === "yes"
        ? `${plural(n, "casual")} said yes`
        : state === "waiting"
          ? `${plural(n, "offer")} waiting for a reply`
          : `${plural(n, "offer")} said no or closed`,
    sub:
      state === "yes"
        ? "They were booked."
        : state === "waiting"
          ? "No answer yet. The first to say yes gets the place."
          : why.length > 0
            ? `${upper(why.join(", "))}.`
            : null,
    error: null,
    groups: [
      {
        label: null,
        rows: w.rows[state].map((r) => offerRow(r, c.timeZone)),
        more: w.more[state] ? showing(w.rows[state]) : null,
        empty: null,
      },
    ],
    foot: [noticeReport(w, c)],
  };
}

export function waitingSessionPanel(s: WaitingSession, w: OffersWeekChart, c: ChartContext): Panel {
  const name = `${roleLabel(s.role)}, ${s.eventName}`;
  const when = `${dayLabel(localDateOf(s.startsAt, c.timeZone))}, ${rangeOf(s.startsAt, s.endsAt, c.timeZone)}`;
  const rows = w.rows.waiting.filter((r) => r.shiftId === s.shiftId);
  return {
    title: `${name}: ${plural(s.waiting, "reply", "replies")} to come`,
    sub: `${when}. The first to say yes gets the place.`,
    error: null,
    groups: [
      {
        label: null,
        rows: rows.map((r) => offerRow(r, c.timeZone)),
        more:
          rows.length < s.waiting
            ? rows.length > 0
              ? showing(rows)
              : "The session's page has them all."
            : null,
        empty: null,
      },
    ],
    foot: [
      { label: "Open the session", href: `/office/shifts/${s.shiftId}` },
      { label: "Offer it to someone else", href: `/office/offer/${s.shiftId}` },
    ],
  };
}

// "46 offers went out this week. 9 haven't had a reply yet; the oldest went at 09:12 yesterday."
export function offersTake(w: OffersWeekChart, c: ChartContext): string {
  const total = w.counts.yes + w.counts.waiting + w.counts.closed;
  if (total === 0) return "";
  const first = `${plural(total, "offer")} went out this week.`;
  const waiting = w.counts.waiting;
  if (waiting > 0) {
    const oldest = w.more.waiting
      ? null
      : w.rows.waiting.reduce<Date | null>(
          (o, r) => (o === null || r.sentAt.getTime() < o.getTime() ? r.sentAt : o),
          null,
        );
    const went = oldest
      ? `; ${waiting === 1 ? "it" : "the oldest"} went ${whenWords(oldest, c)}`
      : "";
    return `${first} ${waiting === 1 ? "1 hasn't" : `${waiting} haven't`} had a reply yet${went}.`;
  }
  return w.counts.yes > 0 ? `${first} ${w.counts.yes} said yes.` : first;
}

export function offersChart(p: Part<OffersWeekChart>, c: ChartContext): ChartCard {
  const { offers: id } = CHART_IDS;
  const title = CHART_TITLES.offers;
  if (!p.ok) return errorCard(id, title, false);
  const w = p.data;
  const total = w.counts.yes + w.counts.waiting + w.counts.closed;
  if (total === 0) return emptyCard(id, title, false, "No offers have gone out this week.");
  const keys: ShareKey[] = SHARE.map((s) => {
    const n = w.counts[s.key];
    const pct = Math.round((n / total) * 100);
    return {
      ...s,
      n,
      pct,
      mark:
        n > 0
          ? mark(
              `${id}:${s.key}`,
              { value: `${n} of ${total}, ${pct}%.`, label: `${s.label}.` },
              offersPanel(w, s.key, c),
            )
          : null,
    };
  });
  const sessions = w.waitingSessions;
  const waiting: BarsBody | null =
    sessions.length > 0
      ? {
          kind: "bars",
          max: Math.max(...sessions.map((s) => s.waiting)),
          rows: sessions.map((s) => {
            const name = `${roleLabel(s.role)}, ${s.eventName}`;
            const sub = `${dayLabel(localDateOf(s.startsAt, c.timeZone))}, ${rangeOf(s.startsAt, s.endsAt, c.timeZone)}`;
            return {
              key: s.shiftId,
              name,
              sub,
              hidden: false,
              segments: [{ tone: "wait" as const, value: s.waiting }],
              total: s.waiting,
              mark: mark(
                `${id}:session:${s.shiftId}`,
                {
                  value: `${plural(s.waiting, "reply", "replies")} to come.`,
                  label: `${name}, ${sub}.`,
                },
                waitingSessionPanel(s, w, c),
              ),
            };
          }),
        }
      : null;
  return {
    id,
    title,
    wide: false,
    error: false,
    take: offersTake(w, c),
    empty: null,
    legend: [],
    body: {
      kind: "offers",
      total,
      aria: keys.map((k) => `${k.n} ${k.label.toLowerCase()}`).join(", "),
      keys,
      waiting,
      waitingMore: w.waitingSessionsMore ? "More sessions are waiting for replies too." : null,
    },
    tables: [
      {
        caption: null,
        head: ["Answer", "Offers", "Share"],
        rows: keys.map((k) => [k.label, String(k.n), `${k.pct}%`]),
      },
      ...(waiting
        ? [
            {
              caption: "Still waiting for a reply",
              head: ["Session", "Replies to come"],
              rows: waiting.rows.map((r) => [`${r.name}, ${r.sub}`, String(r.total)]),
            },
          ]
        : []),
    ],
    hint: "Pick a number to see who.",
    swipe: null,
    notes: [],
  };
}

// --- 4. How long things have waited -----------------------------------------------------------

export const AGES = [
  { label: "Today", phrase: "since today" },
  { label: "Yesterday", phrase: "since yesterday" },
  { label: "2–3 days", phrase: "2 or 3 days" },
  { label: "4–6 days", phrase: "4 to 6 days" },
  { label: "A week or more", phrase: "a week or more" },
] as const;

// How long since a firm day, as one of the five ages (calendar days: the clock change can't move
// it).
export function ageOf(day: string, today: string): number {
  const days = daysUntil(day, today);
  if (days <= 0) return 0;
  if (days === 1) return 1;
  if (days <= 3) return 2;
  if (days <= 6) return 3;
  return 4;
}

const youOf = (needsYou: Record<string, number>) =>
  Object.values(needsYou).reduce((n, v) => n + v, 0);

// The kinds the ages count from Needs attention's own lists, at most 50 each (`more`: one stopped
// there, so its counts are "at least"). Uploads and enquiries are counted in full.
const LISTED: readonly WaitedKind[] = ["to-mark", "evidence", "planner-refused", "webhook"];
const listCapped = (w: WaitedChart, kind: WaitedKind) => LISTED.includes(kind) && w.more[kind];
const agesCapped = (w: WaitedChart) => LISTED.some((k) => w.more[k]);
// Needs attention keeps the newest 50 of these (loadToMark: the sessions that ended last;
// loadEvidence: the strikes issued last, as they were cancelled), so those past 50 are older than
// every one loaded: of the ages, only the one holding the kind's oldest loaded item can be short.
// Planner-refused is kept by the session's start, so any age holding it can be.
const NEWEST_FIRST: readonly WaitedKind[] = ["to-mark", "evidence"];
// A kind here whose list stopped at 50 may have more of this age than its rows.
function shortAt(w: WaitedChart, kind: WaitedKind, age: number): boolean {
  if (!listCapped(w, kind)) return false;
  if (!NEWEST_FIRST.includes(kind)) return true;
  const ages = w.items.filter((i) => i.kind === kind).map((i) => ageOf(i.day, w.today));
  return ages.length > 0 && Math.max(...ages) === age;
}

export function agePanel(w: WaitedChart, age: number, c: ChartContext): Panel {
  const days = w.days.filter((d) => ageOf(d.day, w.today) === age);
  const you = days.reduce((n, d) => n + youOf(d.needsYou), 0);
  const payDays = w.pay ? w.pay.days.filter((d) => ageOf(d.day, w.today) === age) : [];
  const pay = payDays.reduce((n, d) => n + d.count, 0);
  const items = w.items
    .filter((i) => ageOf(i.day, w.today) === age)
    .sort((a, b) => a.since.getTime() - b.since.getTime());
  const payRows = w.pay ? w.pay.rows.filter((q) => ageOf(q.day, w.today) === age) : [];
  const words = [you > 0 ? `${you} for you` : null, pay > 0 ? `${pay} with payroll` : null].filter(
    Boolean,
  );
  // Fewer rows than the count (the oldest 50 uploads and enquiries are loaded, so a newer age can
  // have none), or a kind here whose list stopped at 50 and may be short in this age: say so, and
  // where they are.
  const youMore =
    items.length < you || [...new Set(items.map((i) => i.kind))].some((k) => shortAt(w, k, age));
  return {
    title: `${AGES[age]!.label}: ${plural(you + pay, "thing")} waiting`,
    sub: words.length > 0 ? `${words.join(", ")}.` : null,
    error: null,
    groups: [
      ...(you > 0
        ? [
            {
              label: "Needs you",
              rows: items.map((i) => waitedRow(i, c.timeZone)),
              more: youMore
                ? items.length > 0
                  ? showing(items)
                  : "They're on Needs attention."
                : null,
              empty: null,
            },
          ]
        : []),
      ...(pay > 0
        ? [
            {
              label: "With payroll",
              rows: payRows.map((q) => payRow(q, c.timeZone)),
              more:
                payRows.length < pay
                  ? payRows.length > 0
                    ? showing(payRows)
                    : "They're on the pay queries page."
                  : null,
              empty: null,
            },
          ]
        : []),
    ],
    foot: [
      { label: "Open Needs attention", href: "/office/needs-attention" },
      ...(pay > 0 ? [{ label: "Open the pay queries", href: "/office/pay-queries" }] : []),
    ],
  };
}

// "3 pay queries have waited a week or more with payroll." A list the ages count from stopped at
// 50: what's for you is "at least" (and never "everything came in today": older ones may be past
// it).
export function waitedTake(w: WaitedChart): string {
  const by = AGES.map((_, age) => ({
    you: w.days
      .filter((d) => ageOf(d.day, w.today) === age)
      .reduce((n, d) => n + youOf(d.needsYou), 0),
    pay: w.pay
      ? w.pay.days.filter((d) => ageOf(d.day, w.today) === age).reduce((n, d) => n + d.count, 0)
      : 0,
  }));
  const oldest = by.findLastIndex((b) => b.you + b.pay > 0);
  const b = by[oldest];
  if (!b) return "";
  const capped = agesCapped(w);
  if (oldest === 0)
    return capped
      ? `At least ${plural(b.you + b.pay, "thing")} came in today.`
      : "Everything waiting came in today.";
  const phrase = AGES[oldest]!.phrase;
  const have = (n: number) => (n === 1 ? "has" : "have");
  const you = upper(`${capped ? "at least " : ""}${plural(b.you, "thing")} for you`);
  if (b.you > 0 && b.pay > 0)
    return `${you} and ${plural(b.pay, "pay query", "pay queries")} with payroll have waited ${phrase}.`;
  if (b.you > 0) return `${you} ${have(b.you)} waited ${phrase}.`;
  return `${plural(b.pay, "pay query", "pay queries")} ${have(b.pay)} waited ${phrase} with payroll.`;
}

// Which of Needs attention's lists with no date of their own stopped at 50 (its `toCheckMore`,
// `fromSheetMore` and `expiredMore`): their counts under the chart are "50+".
export interface UndatedMore {
  toCheck: boolean;
  fromSheet: boolean;
  expired: boolean;
}
const NO_UNDATED_MORE: UndatedMore = { toCheck: false, fromSheet: false, expired: false };

// A count from a list that may have stopped at 50: "50+ bookings to check".
const listCount = (n: number, more: boolean, one: string, many: string) =>
  more ? `${n}+ ${many}` : plural(n, one, many);

// Needs attention's items with no date of their own: named under the chart, each to its part of
// Needs attention.
export function undatedNote(w: WaitedChart, more: UndatedMore = NO_UNDATED_MORE): ChartNote | null {
  const u = w.undated;
  const links = [
    u.toCheck > 0
      ? {
          text: listCount(u.toCheck, more.toCheck, "booking to check", "bookings to check"),
          href: "/office/needs-attention#to-check",
        }
      : null,
    u.fromSheet > 0
      ? {
          text: listCount(
            u.fromSheet,
            more.fromSheet,
            "change from your sheet",
            "changes from your sheet",
          ),
          href: "/office/needs-attention#from-sheet",
        }
      : null,
    u.expired > 0
      ? {
          text: listCount(
            u.expired,
            more.expired,
            "qualification out of date on a booking",
            "qualifications out of date on a booking",
          ),
          href: "/office/needs-attention#expired",
        }
      : null,
    u.strikesAddress > 0
      ? { text: "The strikes team's email to set", href: "/office/needs-attention#evidence" }
      : null,
  ].filter((l): l is { text: string; href: string } => l !== null);
  return links.length > 0 ? { text: "Not counted by age:", links } : null;
}

// `undatedMore`: Needs attention's own `…More` for its lists with no date (the loaded dashboard's).
export function waitedChart(
  p: Part<WaitedChart>,
  c: ChartContext,
  undatedMore: UndatedMore = NO_UNDATED_MORE,
): ChartCard {
  const { waited: id } = CHART_IDS;
  const title = CHART_TITLES.waited;
  if (!p.ok) return errorCard(id, title, false);
  const w = p.data;
  const undated = undatedNote(w, undatedMore);
  // Any list it counts from stopped at 50: the Needs attention count card's own words.
  const capped =
    w.needsYouMore ||
    agesCapped(w) ||
    undatedMore.toCheck ||
    undatedMore.fromSheet ||
    undatedMore.expired;
  const notes: ChartNote[] = [
    ...(undated ? [undated] : []),
    ...(capped ? [{ text: LISTS_STOP, links: [] }] : []),
  ];
  const columns: Column[] = AGES.map((a, age) => {
    const you = w.days
      .filter((d) => ageOf(d.day, w.today) === age)
      .reduce((n, d) => n + youOf(d.needsYou), 0);
    const pay = w.pay
      ? w.pay.days.filter((d) => ageOf(d.day, w.today) === age).reduce((n, d) => n + d.count, 0)
      : 0;
    const total = you + pay;
    return {
      key: String(age),
      top: null,
      bottom: a.label,
      now: false,
      dim: total === 0,
      segments: segments([
        { tone: "open", value: you },
        { tone: "wait", value: pay },
      ]),
      total,
      full: false,
      mark:
        total > 0
          ? mark(
              `${id}:${age}`,
              {
                value: `${plural(total, "thing")} waiting.`,
                label: `${a.label}: ${you} for you${w.pay ? `, ${pay} with payroll` : ""}.`,
              },
              agePanel(w, age, c),
            )
          : null,
    };
  });
  if (columns.every((col) => col.total === 0))
    return emptyCard(
      id,
      title,
      false,
      undated ? "Nothing with a date of its own is waiting." : "Nothing is waiting.",
      notes,
    );
  const { max, ticks } = scale(Math.max(...columns.map((col) => col.total)));
  return {
    id,
    title,
    wide: false,
    error: false,
    take: waitedTake(w),
    empty: null,
    legend: [
      { tone: "open", label: "Needs you" },
      ...(w.pay ? [{ tone: "wait" as const, label: "With payroll" }] : []),
    ],
    body: { kind: "columns", max, ticks, columns, end: false },
    tables: [
      {
        caption: null,
        head: ["Waited", "Needs you", ...(w.pay ? ["With payroll"] : [])],
        rows: columns.map((col) => [
          col.bottom,
          String(col.segments.find((s) => s.tone === "open")?.value ?? 0),
          ...(w.pay ? [String(col.segments.find((s) => s.tone === "wait")?.value ?? 0)] : []),
        ]),
      },
    ],
    hint: "Pick a column to see what's waiting.",
    swipe: null,
    notes,
  };
}

// --- 5. Cancellations, the last 14 days ---------------------------------------------------------

export function cancelDayPanel(
  date: string,
  total: number,
  short: number,
  ch: CancelsChart,
  c: ChartContext,
): Panel {
  const rows = ch.rows.filter((r) => localDateOf(r.cancelledAt, c.timeZone) === date);
  return {
    title: `${dayLabel(date)}: ${plural(total, "cancellation")}`,
    sub: `${short > 0 ? `${short} under ${ch.threshold} hours' notice. ` : ""}Recorded automatically, never approved or declined.`,
    error: null,
    groups: [
      {
        label: null,
        rows: rows.map((r) => ({
          key: r.assignmentId,
          title: cancelledByText(r),
          href: null,
          sub: `${roleLabel(r.role)}${r.eventName ? `, ${r.eventName}` : ""}. The shift: ${timeOnDay(r.startsAt, c.timeZone)}. ${noticeChip(noticeText(r.noticeHours))}.`,
          count: null,
          chips: [
            r.noticeHours < ch.threshold
              ? { tone: "urgent" as const, text: "Short notice" }
              : { tone: "quiet" as const, text: "With notice" },
          ],
          action: { label: "Open", href: `/office/cancellations/${r.ref}` },
        })),
        more:
          rows.length < total
            ? rows.length > 0
              ? showing(rows)
              : "They're on the Cancellations page."
            : null,
        empty: null,
      },
    ],
    foot:
      date === c.today
        ? [{ label: "See today's cancellations", href: "/office/cancellations?day=today" }]
        : [{ label: "See all cancellations", href: "/office/cancellations" }],
  };
}

export function cancelsTake(ch: CancelsChart): string {
  const total = ch.days.reduce((n, d) => n + d.total, 0);
  const short = ch.days.reduce((n, d) => n + d.short, 0);
  if (total === 0) return "";
  return `${plural(total, "cancellation")} in the last 2 weeks. ${
    short > 0
      ? `${short} came with under ${ch.threshold} hours' notice.`
      : `${total === 1 ? "It" : "All"} came with ${ch.threshold} hours' notice or more.`
  }`;
}

export function cancelsChart(p: Part<CancelsChart>, c: ChartContext): ChartCard {
  const { cancels: id } = CHART_IDS;
  const title = CHART_TITLES.cancels;
  if (!p.ok) return errorCard(id, title, false);
  const ch = p.data;
  if (ch.days.every((d) => d.total === 0))
    return emptyCard(id, title, false, "No cancellations in the last 2 weeks.");
  const { max, ticks } = scale(Math.max(...ch.days.map((d) => d.total)));
  return {
    id,
    title,
    wide: false,
    error: false,
    take: cancelsTake(ch),
    empty: null,
    legend: [
      { tone: "urgent", label: `Under ${ch.threshold} hours' notice` },
      { tone: "calm", label: "With notice" },
    ],
    body: {
      kind: "columns",
      max,
      ticks,
      end: true,
      // 14 narrow columns at half width can't fit "Today" or "Wed": the weekday's first letter
      // over each date (today included: its date pill marks it), the full day in each mark's name.
      columns: ch.days.map((d) => {
        const p2 = datePartsOfDay(d.date);
        const today = d.date === c.today;
        return {
          key: d.date,
          top: p2.dow.slice(0, 1),
          bottom: p2.day,
          now: today,
          dim: d.total === 0,
          segments: segments([
            { tone: "urgent", value: d.short },
            { tone: "calm", value: d.total - d.short },
          ]),
          total: d.total,
          full: false,
          mark:
            d.total > 0
              ? mark(
                  `${id}:${d.date}`,
                  {
                    value: `${plural(d.total, "cancellation")}.`,
                    label: `${dayLabel(d.date)}${today ? ", today" : ""}${d.short > 0 ? `: ${d.short} under ${ch.threshold} hours' notice` : ""}.`,
                  },
                  cancelDayPanel(d.date, d.total, d.short, ch, c),
                )
              : null,
        };
      }),
    },
    tables: [
      {
        caption: null,
        head: ["Day", "Short notice", "With notice"],
        rows: ch.days
          .filter((d) => d.total > 0)
          .map((d) => [dayLabel(d.date), String(d.short), String(d.total - d.short)]),
      },
    ],
    hint: "Pick a day to see who cancelled.",
    swipe: "Swipe for earlier days.",
    notes: [],
  };
}

// --- 6. Licences running out, the next 8 weeks ----------------------------------------------

// The booking it won't be in date for, by its days. One that starts after the day it runs out:
// that day ("on Sat 31 Oct"). One that starts while it's still in date and runs past the day it
// runs out (a night session from 22:00 that day): its first and last days, so the words never say
// "after it runs out" of a booking on the day it's still in date.
function bookedDays(l: LicenceRow, tz: string) {
  if (!l.booked) return null;
  const from = localDateOf(l.booked.startsAt, tz);
  return {
    from: dayLabel(from),
    to: dayLabel(l.booked.lastDay),
    across: from <= l.expiresOn && l.booked.lastDay > l.expiresOn,
  };
}

export function licencePanel(l: LicenceRow, tz: string): Panel {
  const b = bookedDays(l, tz);
  return {
    title: `${l.casual}: ${l.name}`,
    sub: `Runs out ${dayLabel(l.expiresOn)}, ${l.days === 0 ? "at the end of today" : `in ${plural(l.days, "day")}`}.`,
    error: null,
    groups: [
      {
        label: null,
        rows: [
          ...(l.booked && b
            ? [
                {
                  key: "booked",
                  title: `Booked ${b.across ? `${b.from} to ${b.to}` : `on ${b.from}`}: ${roleLabel(l.booked.role)}`,
                  href: null,
                  sub: "It won't be in date for this booking.",
                  count: null,
                  chips: [{ tone: "urgent" as const, text: "Booked after it runs out" }],
                  action: {
                    label: "Open the booking",
                    href: `/office/shifts/${l.booked.shiftId}`,
                    main: true,
                  },
                },
              ]
            : []),
          ...(l.renewalWaiting
            ? [
                {
                  key: "renewal",
                  title: "A new one is waiting for a check",
                  href: null,
                  sub: null,
                  count: null,
                  chips: [{ tone: "attention" as const, text: "Upload" }],
                  action: { label: "Check", href: `/office/casuals/${l.workerId}#uploads` },
                },
              ]
            : []),
          {
            key: "record",
            title: `${l.casual}'s record`,
            href: null,
            sub: "Their licences, bookings and contact details.",
            count: null,
            chips: [],
            action: { label: "Open", href: `/office/casuals/${l.workerId}` },
          },
        ],
        more: null,
        empty: null,
      },
    ],
    foot: [],
  };
}

export function licencesTake(lc: LicencesChart, tz: string): string {
  if (lc.counts.total === 0) return "";
  const runs = (n: number) => `${plural(n, "licence")} ${n === 1 ? "runs" : "run"} out`;
  const first =
    lc.counts.soon > 0
      ? `${runs(lc.counts.soon)} in the next ${lc.soonDays} days.`
      : `${runs(lc.counts.total)} in the next 8 weeks, none in the next ${lc.soonDays} days.`;
  const booked = lc.rows.find((l) => l.booked);
  const b = booked ? bookedDays(booked, tz) : null;
  return booked && b
    ? `${first} ${booked.casual}'s runs out on ${dayLabel(booked.expiresOn)}, and they're booked ${b.across ? `until ${b.to}` : `on ${b.from}`}.`
    : first;
}

// Dots on lanes over the 8 weeks: a dot takes the lowest lane whose last dot is more than 6 days
// before it (so close dates don't overlap).
const LANE_GAP_DAYS = 6;
const MAX_LANES = 6;

export function licencesChart(p: Part<LicencesChart>, c: ChartContext): ChartCard {
  const { licences: id } = CHART_IDS;
  const title = CHART_TITLES.licences;
  if (!p.ok) return errorCard(id, title, true);
  const lc = p.data;
  if (lc.rows.length === 0)
    return emptyCard(id, title, true, "No licences run out in the next 8 weeks.");
  const lanes: number[] = [];
  const dots: Dot[] = lc.rows.map((l) => {
    let lane = lanes.findIndex((last) => l.days - last > LANE_GAP_DAYS);
    if (lane < 0 && lanes.length < MAX_LANES) {
      lane = lanes.length;
      lanes.push(l.days);
    } else if (lane < 0) {
      lane = MAX_LANES - 1;
      lanes[lane] = l.days;
    } else lanes[lane] = l.days;
    const tone: MarkTone = l.booked ? "urgent" : l.soon ? "open" : "calm";
    const b = bookedDays(l, c.timeZone);
    const bookedWords = !b
      ? ""
      : b.across
        ? `. Booked ${b.from} to ${b.to}, past the day it runs out`
        : `. Booked on ${b.from}, after it runs out`;
    return {
      key: l.credentialId,
      x: (l.days / lc.windowDays) * 100,
      lane,
      tone,
      big: l.booked !== null,
      name: l.booked ? l.casual : null,
      mark: mark(
        `${id}:${l.credentialId}`,
        {
          value: `Runs out ${dayLabel(l.expiresOn)}.`,
          label: `${l.casual}, ${l.name}${bookedWords}.`,
        },
        licencePanel(l, c.timeZone),
      ),
    };
  });
  const ticks: TimelineBody["ticks"] = [];
  for (let d = 1; d < lc.windowDays; d++) {
    const day = addDays(lc.today, d);
    const parts = datePartsOfDay(day);
    if (parts.dow === "Mon")
      ticks.push({
        x: (d / lc.windowDays) * 100,
        label: `${parts.day} ${parts.month}`,
        alt: ticks.length % 2 === 1,
      });
  }
  return {
    id,
    title,
    wide: true,
    error: false,
    take: licencesTake(lc, c.timeZone),
    empty: null,
    legend: [
      { tone: "urgent", label: "Booked after it runs out", round: true },
      { tone: "open", label: `Runs out within ${lc.soonDays} days`, round: true },
      { tone: "calm", label: "Later", round: true },
    ],
    body: { kind: "timeline", lanes: Math.max(1, lanes.length), ticks, dots },
    tables: [
      {
        caption: null,
        head: ["Casual", "Licence", "Runs out", "Booked after"],
        rows: lc.rows.map((l) => [
          l.casual,
          l.name,
          dayLabel(l.expiresOn),
          l.booked ? "Yes" : "No",
        ]),
      },
    ],
    hint: "Pick a dot to see the casual.",
    swipe: null,
    notes: lc.more
      ? [{ text: `Showing the first ${lc.rows.length} of ${lc.counts.total}.`, links: [] }]
      : [],
  };
}

// --- The four count cards ---------------------------------------------------------------------

const urgentRow = (i: FocusItem): PanelRow => ({
  key: i.shiftId,
  title: i.role,
  href: `/office/shifts/${i.shiftId}`,
  sub: `${i.dow} ${i.day} ${i.month}, ${i.range}. ${i.where}. ${placesFilledText(i.placesLeft, i.headcount)}.`,
  count: null,
  chips: [
    { tone: "urgent", text: "Urgent" },
    ...(i.hidden ? [{ tone: "quiet" as const, text: "Hidden from casuals" }] : []),
    i.notOffered
      ? { tone: "attention" as const, text: "Not offered yet" }
      : {
          tone: i.offered.startsWith("Offers stopped") ? ("quiet" as const) : ("wait" as const),
          text: i.offered,
        },
  ],
  // Hidden from casuals, it can't be offered: its page has its switch.
  action: i.hidden ? null : { label: "Offer", href: `/office/offer/${i.shiftId}`, main: true },
});

export function countCards(
  d: Dashboard,
  o: { pay: boolean; payQueriesWaiting: number | null },
): CountCard[] {
  const tz = d.timeZone;
  const c = d.counts;
  const focus = focusItems(d);
  const needs = d.needs.ok ? d.needs.data : null;
  const needPerson = c.enquiries.ok ? c.enquiries.data.needPerson : 0;
  const after = afterRows(needs, needPerson, tz);
  const attention = needs ? attentionCount(needs, needPerson) : null;
  const figure = attention ? `${attention.count}${attention.more ? "+" : ""}` : null;
  const places = c.urgent.ok ? c.urgent.data.places : 0;
  const waiting = o.payQueriesWaiting;
  const pay = d.waited.ok ? d.waited.data.pay : null;
  const sortedParts = [
    c.cancellations.ok ? plural(c.cancellations.data.total, "cancellation") : null,
    c.enquiries.ok ? plural(c.enquiries.data.total, "enquiry", "enquiries") : null,
  ];
  const sortedKnown = c.cancellations.ok || c.enquiries.ok;
  const sorted =
    (c.cancellations.ok ? c.cancellations.data.total : 0) +
    (c.enquiries.ok ? c.enquiries.data.total : 0);
  return [
    {
      key: "urgent",
      tone: "urgent",
      label: "Urgent places",
      value: c.urgent.ok ? String(places) : "–",
      caption: !c.urgent.ok
        ? COUNT_ERROR
        : places === 0
          ? "Every urgent place is filled"
          : urgentDaysText(focus),
      href: "#urgent-places",
      panel: {
        title: !c.urgent.ok
          ? "Urgent places"
          : places === 0
            ? "Every urgent place is filled"
            : `${plural(places, "urgent place")} to fill`,
        sub: "Casuals see these first and get an alert.",
        error: d.urgent.ok ? null : SECTION_ERROR,
        groups: d.urgent.ok
          ? [
              {
                label: null,
                rows: focus.map(urgentRow),
                more: d.urgent.data.more ? "More urgent places are on Events & sessions." : null,
                empty: focus.length === 0 ? "Nobody needs finding right now." : null,
              },
            ]
          : [],
        foot: [{ label: "All on Events & sessions", href: "/office/events?view=urgent" }],
      },
    },
    {
      key: "needs",
      tone: "attention",
      label: "Needs attention",
      value: figure ?? "–",
      caption: attention ? attentionText(after) : COUNT_ERROR,
      href: "/office/needs-attention",
      panel: {
        title: !attention
          ? "What needs attention"
          : attention.count === 0
            ? "Nothing needs attention"
            : `${figure} ${attention.count === 1 && !attention.more ? "thing needs" : "things need"} attention`,
        sub: "Each one links to where it's dealt with.",
        error: needs ? null : SECTION_ERROR,
        groups: [
          {
            label: null,
            rows: after.map(needsRow),
            more: attention?.more ? LISTS_STOP : null,
            empty: needs && after.length === 0 ? SECTIONS.needs.empty : null,
          },
        ],
        foot: [{ label: "Open Needs attention", href: "/office/needs-attention" }],
      },
    },
    {
      key: "waiting",
      tone: "wait",
      label: "Waiting on others",
      value: waiting === null ? "–" : String(waiting),
      caption:
        waiting === null
          ? COUNT_ERROR
          : waiting > 0
            ? "Pay queries with payroll"
            : "Nothing waiting on others",
      href: o.pay ? "/office/pay-queries" : `#${CHART_IDS.waited}`,
      panel: {
        title:
          waiting === null
            ? "Waiting on others"
            : waiting > 0
              ? `${plural(waiting, "pay query", "pay queries")} with payroll`
              : "Nothing is waiting on anyone else",
        sub:
          waiting && waiting > 0
            ? "Payroll gets them grouped in its digest. Nothing for you to do."
            : null,
        error: waiting === null ? SECTION_ERROR : null,
        groups:
          o.pay && waiting !== null && waiting > 0
            ? [
                {
                  label: null,
                  rows: pay ? pay.rows.map((q) => payRow(q, tz)) : [],
                  more: pay
                    ? pay.more
                      ? showing(pay.rows)
                      : null
                    : "The pay queries page has them all.",
                  empty: null,
                },
              ]
            : [],
        foot: o.pay
          ? [{ label: "Open the pay queries", href: "/office/pay-queries" }]
          : [{ label: "See how long things have waited", href: `#${CHART_IDS.waited}` }],
      },
    },
    {
      key: "sorted",
      tone: "done",
      label: "Sorted today",
      value: sortedKnown ? String(sorted) : "–",
      caption: sortedKnown ? sortedParts.filter(Boolean).join(", ") : COUNT_ERROR,
      href: "/office/cancellations?day=today",
      panel: {
        title: sortedKnown ? `${plural(sorted, "thing")} sorted today` : "Sorted today",
        sub: null,
        error: null,
        groups: [
          {
            label: null,
            rows: sortedRows(d).map((r) => ({
              key: r.key,
              title: r.title,
              href: r.href,
              sub: r.sub,
              count: null,
              chips: [],
              action: null,
            })),
            more: null,
            empty: null,
          },
        ],
        foot: [],
      },
    },
  ];
}

// --- The whole dashboard ----------------------------------------------------------------------

export function dashboardModel(
  d: Dashboard,
  o: { now: Date; pay: boolean; payQueriesWaiting: number | null },
): DashboardModel {
  const c: ChartContext = { timeZone: d.timeZone, today: d.today, now: o.now };
  const needs = d.needs.ok ? d.needs.data : null;
  const toMark = needs ? needs.toMark : [];
  // The waiting chart is read from Needs attention's items (none without them).
  const undatedMore: UndatedMore = needs
    ? { toCheck: needs.toCheckMore, fromSheet: needs.fromSheetMore, expired: needs.expiredMore }
    : NO_UNDATED_MORE;
  return {
    cards: countCards(d, o),
    charts: [
      placesChart(d.fill, c, toMark),
      eventsChart(d.eventsNeed, c),
      offersChart(d.offersWeek, c),
      waitedChart(d.waited, c, undatedMore),
      cancelsChart(d.cancels14, c),
      licencesChart(d.licences, c),
    ],
  };
}
