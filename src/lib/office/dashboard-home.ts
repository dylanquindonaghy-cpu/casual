import { localDateOf, wallTimeOf } from "../time/zoned";
import { datePartsOfDay, timeRange } from "../portal/sign-copy";
import { roleLabel } from "../portal/format";
import type { Dashboard, NeedsAttention } from "./dashboard";
import { evidenceItems } from "./dashboard";
import {
  COUNT_ERROR,
  HIDDEN_WARNING,
  NEEDS_HEADINGS,
  urgentLine,
  type NeedsKey,
} from "./dashboard-copy";

// The dashboard's redesign (Phases 18 and 20; docs/office-v2.md 3.2; docs/screens.md `/office`),
// one question: "what needs me now, and where do I start?". Worked out here from the loaded
// dashboard, pure, so the page only lays it out: the greeting and how many things need you (the
// one count: the urgent places and Needs attention's items), where to start, the urgent places,
// and the rows the count cards open: Needs attention's (one per kind) and "Sorted today"'s.
// Phase 23: this week's strip gave way to the charts (dashboard-charts.ts: the next 14 days'
// places, each day opening its sessions, its sessions to mark and the rota board).

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// --- The headline ------------------------------------------------------------------------------

// `complete`: every part the count comes from could be read. When one couldn't, the headline never
// says nothing needs you (it can't know), only "at least" what it could read.
export function headline(things: number, complete = true): string {
  if (!complete) {
    if (things === 0) return "Some of the dashboard couldn't load";
    return things === 1 ? "At least 1 thing needs you" : `At least ${things} things need you`;
  }
  if (things === 0) return "Nothing needs you right now";
  return things === 1 ? "1 thing needs you" : `${things} things need you`;
}

export function subline(urgentPlaces: number, things: number, complete = true): string {
  if (urgentPlaces > 0)
    return "Start with the urgent places. Casuals see these first and get an alert.";
  if (!complete) return "Reload the page to try again. What could load is below.";
  if (things > 0) return "Urgent places are sorted. The rest is below.";
  return "Every urgent place is filled, and nothing else is waiting for you.";
}

// --- The urgent places, one at a time ----------------------------------------------------------

export interface FocusItem {
  shiftId: string;
  dow: string;
  day: string;
  month: string;
  dateLong: string;
  range: string;
  role: string;
  where: string; // "Northern Lights Live, Acme Demo Arena"
  headcount: number;
  placesLeft: number;
  offered: string; // "Offered to 2 casuals", or why the offers stopped
  notOffered: boolean; // nobody offered yet: the line takes the sign yellow
  hidden: string | null; // the hidden warning, when casuals can't see the gap
  escalated: boolean;
  fromSheet: boolean;
  fromPlanner: boolean;
}

// Soonest first (then by session, so the order is fixed): the events come in the order of their
// first session to come, which needn't be their first urgent one.
export function focusItems(d: Dashboard): FocusItem[] {
  if (!d.urgent.ok) return [];
  const sessions = d.urgent.data.events
    .flatMap((e) => e.sessions.map((s) => ({ e, s })))
    .sort(
      (a, b) =>
        a.s.startsAt.getTime() - b.s.startsAt.getTime() || a.s.shiftId.localeCompare(b.s.shiftId),
    );
  return sessions.map(({ e, s }) => {
    const p = datePartsOfDay(localDateOf(s.startsAt, d.timeZone));
    return {
      shiftId: s.shiftId,
      dow: p.dow,
      day: p.day,
      month: p.month,
      dateLong: p.long,
      range: timeRange(s.startsAt, s.endsAt, d.timeZone).range,
      role: roleLabel(s.role),
      where: [e.name, e.place && e.place !== e.name ? e.place : null].filter(Boolean).join(", "),
      headcount: s.headcount,
      placesLeft: s.placesLeft,
      offered: urgentLine(s),
      notOffered: s.offered === 0 && s.stopped === null,
      hidden: !e.showing || !s.showing ? HIDDEN_WARNING : null,
      escalated: s.escalated,
      fromSheet: s.fromSheet,
      fromPlanner: s.fromPlanner,
    };
  });
}

// --- After that, waiting on others, sorted today ----------------------------------------------

export interface Row {
  key: string;
  title: string;
  sub: string;
  count: string | null;
  href: string;
}

const needsHref = (key: NeedsKey) => `/office/needs-attention#${key}`;
const more = (n: number, m: boolean) => (m ? `${n}+` : String(n));

// Everything else that needs this person, a row per kind, in Needs attention's order.
export function afterRows(n: NeedsAttention | null, needPerson: number, timeZone: string): Row[] {
  const out: Row[] = [];
  if (n) {
    if (n.toCheck.length > 0)
      out.push({
        key: "to-check",
        title: NEEDS_HEADINGS["to-check"],
        sub: "Booked, but can't work these shifts as things stand",
        count: more(n.toCheck.length, n.toCheckMore),
        href: needsHref("to-check"),
      });
    if (n.fromSheet.length > 0)
      out.push({
        key: "from-sheet",
        title: NEEDS_HEADINGS["from-sheet"],
        sub: "Changes your rota sheet asked for that the app couldn't do",
        count: more(n.fromSheet.length, n.fromSheetMore),
        href: needsHref("from-sheet"),
      });
    if (n.toMark.length > 0) {
      const days = [...new Set(n.toMark.map((t) => localDateOf(t.startsAt, timeZone)))];
      const on =
        days.length === 1 && days[0]
          ? ` on ${(({ dow, day, month }) => `${dow} ${day} ${month}`)(datePartsOfDay(days[0]))}`
          : "";
      out.push({
        key: "to-mark",
        title: NEEDS_HEADINGS["to-mark"],
        sub: `${plural(n.toMark.length, "session", "sessions")}${on} to mark`,
        count: more(n.toMark.length, n.toMarkMore),
        href: needsHref("to-mark"),
      });
    }
    if (n.expired.length > 0)
      out.push({
        key: "expired",
        title: NEEDS_HEADINGS.expired,
        sub: "A booked casual's qualification runs out before their shift",
        count: more(n.expired.length, n.expiredMore),
        href: needsHref("expired"),
      });
    if (n.uploads > 0)
      out.push({
        key: "uploads",
        title: NEEDS_HEADINGS.uploads,
        sub: "Photos and documents from casuals",
        count: String(n.uploads),
        href: "/office/casuals?view=uploads",
      });
    const evidence = evidenceItems(n.evidence);
    if (evidence > 0)
      out.push({
        key: "evidence",
        title: NEEDS_HEADINGS.evidence,
        sub: "Strike records the strikes team hasn't had",
        count: more(evidence, n.evidence.failedMore),
        href: needsHref("evidence"),
      });
    if (n.plannerRefused.length > 0)
      out.push({
        key: "planner-refused",
        title: NEEDS_HEADINGS["planner-refused"],
        sub: "Changes to booked sessions that weren't made",
        count: more(n.plannerRefused.length, n.plannerRefusedMore),
        href: needsHref("planner-refused"),
      });
    if (n.webhookFailing)
      out.push({
        key: "webhook",
        title: NEEDS_HEADINGS.webhook,
        sub: "Your planner isn't hearing about changes",
        count: null,
        href: needsHref("webhook"),
      });
  }
  if (needPerson > 0)
    out.push({
      key: "enquiries",
      title: "Enquiries that need a person",
      sub: "Messages and requests the shifts line couldn't answer",
      count: String(needPerson),
      href: "/office/enquiries",
    });
  return out;
}

// What's sorted today, from the counts: cancellations (recorded, never approved), enquiries
// answered, what casuals can see.
export function sortedRows(d: Dashboard): Row[] {
  const c = d.counts;
  const cancel = c.cancellations.ok ? c.cancellations.data : null;
  const enq = c.enquiries.ok ? c.enquiries.data : null;
  const show = c.showing.ok ? c.showing.data : null;
  return [
    {
      key: "cancellations",
      title: cancel
        ? `${plural(cancel.total, "cancellation", "cancellations")} today`
        : "Cancellations today",
      sub: cancel
        ? `${cancel.underNotice} under ${cancel.threshold} hours' notice, ${plural(cancel.strikes, "strike", "strikes")} issued. Recorded automatically, never approved or declined.`
        : COUNT_ERROR,
      count: null,
      href: "/office/cancellations?day=today",
    },
    {
      key: "enquiries",
      title: enq ? `${plural(enq.total, "enquiry", "enquiries")} today` : "Enquiries today",
      sub: enq
        ? `${enq.automatic} answered automatically. ${
            enq.needPerson === 0
              ? "None need a person."
              : `${enq.needPerson} ${enq.needPerson === 1 ? "needs" : "need"} a person.`
          }`
        : COUNT_ERROR,
      count: null,
      href: "/office/enquiries?day=today",
    },
    {
      key: "showing",
      title: show
        ? `${plural(show.events, "event", "events")} showing to casuals`
        : "Events showing to casuals",
      sub: show
        ? `${plural(show.places, "open place", "open places")} across ${plural(show.sessions, "session", "sessions")}`
        : COUNT_ERROR,
      count: null,
      href: "/office/events?view=showing",
    },
  ];
}

// --- Phase 20: the greeting, the one count, the tiles -------------------------------------------

// "Morning", "Afternoon" or "Evening", by the firm's clock: the dashboard's greeting.
export function greeting(now: Date, timeZone: string): string {
  const hour = wallTimeOf(now, timeZone).hour;
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

// The one count (Phase 20): the urgent places still to fill and every item of Needs attention
// (with the enquiries that need a person), as the menu counts them.
export const oneCount = (urgentPlaces: number, attention: number) => urgentPlaces + attention;

// A role in a sentence: "door supervisor", "CSAS officer" (an acronym stays in capitals).
const inSentence = (role: string) =>
  /^[A-Z][a-z]/.test(role) ? role.charAt(0).toLowerCase() + role.slice(1) : role;

// Under the count: where to start ("Start with Thursday's door supervisor at 08:00: not offered to
// anyone yet."), or, with no urgent place, what the headline's subline says.
// `urgentPlaces`: the count's, for when the list itself couldn't be read.
export function startLine(
  first: FocusItem | undefined,
  things: number,
  complete = true,
  urgentPlaces = 0,
): string {
  if (!first) return subline(urgentPlaces, things, complete);
  const day = first.dateLong.split(" ")[0] ?? first.dow;
  const at = first.range.split("–")[0] ?? first.range;
  const status = first.notOffered ? "not offered to anyone yet" : inSentence(first.offered);
  return `Start with ${day}'s ${inSentence(first.role)} at ${at}: ${status}.`;
}

// Each urgent place's "…" button, named apart for a screen reader: "More for Thursday's door
// supervisor at 08:00: mark as filled, not urgent" (an acronym stays in capitals; a Google Sheet's
// or a planner's place has only "not urgent" there), and "(2)" on a second with the same words.
export function moreLabels(
  items: Pick<FocusItem, "dateLong" | "dow" | "role" | "range" | "fromSheet" | "fromPlanner">[],
): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const day = item.dateLong.split(" ")[0] ?? item.dow;
    const at = item.range.split("–")[0] ?? item.range;
    const name = `More for ${day}'s ${inSentence(item.role)} at ${at}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const what = item.fromSheet || item.fromPlanner ? "not urgent" : "mark as filled, not urgent";
    return `${name}${n > 1 ? ` (${n})` : ""}: ${what}`;
  });
}

// "Thu 22, Fri 23 and Sat 24": the days of the urgent places, soonest first, each once (three,
// then "and more").
export function urgentDaysText(items: Pick<FocusItem, "dow" | "day" | "shiftId">[]): string {
  const days = [...new Set(items.map((i) => `${i.dow} ${i.day}`))];
  const shown = days.slice(0, 3);
  if (shown.length === 0) return "";
  const list =
    shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)!}`;
  return days.length > 3 ? `${list.replace(/ and /, ", ")} and more` : list;
}

const SHORT: Record<string, [string, string]> = {
  "to-check": ["booking to check", "bookings to check"],
  "from-sheet": ["change from your sheet", "changes from your sheet"],
  "to-mark": ["session to mark", "sessions to mark"],
  expired: ["qualification out of date", "qualifications out of date"],
  uploads: ["upload", "uploads"],
  evidence: ["strike record to send", "strike records to send"],
  "planner-refused": ["refused change", "refused changes"],
  webhook: ["webhook failing", "webhook failing"],
  enquiries: ["enquiry", "enquiries"],
};

// The Needs attention tile's line: what its count is made of ("5 sessions to mark, 2 uploads").
export function attentionText(rows: Row[]): string {
  if (rows.length === 0) return "Nothing waiting for you";
  const parts = rows.map((r) => {
    const [one, many] = SHORT[r.key] ?? ["thing", "things"];
    if (r.count === null) return one;
    return `${r.count} ${r.count === "1" ? one : many}`;
  });
  return parts.length > 2 ? `${parts.slice(0, 2).join(", ")} and more` : parts.join(", ");
}
