import { localDateOf } from "../time/zoned";
import { datePartsOfDay, timeRange } from "../portal/sign-copy";
import { roleLabel } from "../portal/format";
import type { Dashboard, NeedsAttention, WeekDay } from "./dashboard";
import { evidenceItems } from "./dashboard";
import {
  COUNT_ERROR,
  HIDDEN_WARNING,
  NEEDS_HEADINGS,
  urgentLine,
  type NeedsKey,
} from "./dashboard-copy";

// The dashboard's redesign (Phase 18; docs/office-v2.md 3.2; docs/screens.md `/office`), one
// question: "what needs me now, and where do I start?". Worked out here from the loaded dashboard,
// pure, so the page only lays it out: how many things need you (the headline), this week as seven
// days, the urgent places one at a time, "After that" (the rest of what needs you), "Waiting on
// others" and "Sorted today".

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

// --- This week --------------------------------------------------------------------------------

export type WeekNote =
  | { kind: "urgent"; text: string; extra: string | null }
  | { kind: "mark"; text: string }
  | { kind: "open"; text: string }
  | { kind: "filled"; text: string }
  | { kind: "short"; text: string } // places left unfilled that can't be filled now (started, past)
  | { kind: "none"; text: string };

export interface WeekCell {
  date: string;
  dow: string; // "Today" for today
  day: string;
  filledShare: number; // 0 to 1, for the bar
  note: WeekNote;
  href: string;
  label: string; // for screen readers
}

// Each day: what needs doing on it first (sessions to mark, for a day gone by; urgent gaps, in
// places), then how full it is: places that can still be filled ("3 open"), every place filled,
// or, once its sessions have started, how many were ("4 of 6 filled").
export function weekCells(
  days: WeekDay[],
  toMark: { startsAt: Date }[],
  today: string,
  timeZone: string,
): WeekCell[] {
  return days.map((d) => {
    const p = datePartsOfDay(d.date);
    const mark = toMark.filter((t) => localDateOf(t.startsAt, timeZone) === d.date).length;
    const open = d.open;
    const note: WeekNote =
      mark > 0
        ? { kind: "mark", text: `${mark} to mark` }
        : d.urgent > 0
          ? {
              kind: "urgent",
              text: `${d.urgent} urgent`,
              extra: open > d.urgent ? `${open} open` : null,
            }
          : open > 0
            ? { kind: "open", text: `${open} open` }
            : d.places > 0 && d.filled >= d.places
              ? { kind: "filled", text: "All filled" }
              : d.places > 0
                ? { kind: "short", text: `${d.filled} of ${d.places} filled` }
                : { kind: "none", text: "Nothing on" };
    const filledText =
      d.places > 0 && note.kind !== "short" ? `, ${d.filled} of ${d.places} places filled` : "";
    const extra = note.kind === "urgent" && note.extra ? `, ${note.extra}` : "";
    return {
      date: d.date,
      dow: d.date === today ? "Today" : p.dow,
      day: p.day,
      filledShare: d.places > 0 ? d.filled / d.places : 0,
      note,
      href: mark > 0 ? "/office/needs-attention#to-mark" : `/office/shifts?from=${d.date}`,
      label: `${p.dow} ${p.day} ${p.month}${d.date === today ? ", today" : ""}: ${note.text}${extra}${filledText}`,
    };
  });
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

export function focusItems(d: Dashboard): FocusItem[] {
  if (!d.urgent.ok) return [];
  return d.urgent.data.events.flatMap((e) =>
    e.sessions.map((s) => {
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
    }),
  );
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

// How many things need you: the urgent places (one thing), and each row of "After that".
export const thingsCount = (focus: number, after: number) => (focus > 0 ? 1 : 0) + after;
