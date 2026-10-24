import { sql, type SQL } from "drizzle-orm";
import { daysUntil, EXPIRING_SOON_DAYS } from "../credentials/expiry";
import { supersededSql } from "../credentials/superseded";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  type OFFER_RESPONSES,
  type SHIFT_STATUSES,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { payWeekNow } from "../pay/pay-week";
import type { PayIssue } from "../portal/pay-query-kinds";
import { addDays, localDateOf, startOfDay } from "../time/zoned";
import { loadCancellations } from "./cancellations";
import { waitingUploadDays } from "./casuals";
import type {
  CancelDay,
  CancelsChart,
  EventNeed,
  EventsNeedChart,
  FillChart,
  FillDay,
  GapSession,
  LicenceRow,
  LicencesChart,
  OfferRow,
  OffersWeekChart,
  OfferState,
  OfferWhy,
  PayWaitingRow,
  WaitedChart,
  WaitedDay,
  WaitedItem,
  WaitedKind,
  WaitingSession,
} from "./dashboard-chart-types";
import type { NeedsAttention } from "./dashboard";
import { enquiryWindow, isEnquiry, needsPerson } from "./enquiries";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { loadUrgentOffers } from "./today";

// The dashboard's six charts (Phase 23, 23.4; docs/screens.md `/office`): what each mark counts,
// and the rows behind it. Reads only, inside the firm (every query through the FirmTx: RLS scopes
// every row to it; joins on the composite keys). The dashboard (dashboard.ts) reads each in a part
// of its own, so one that fails shows its error and the rest still show. Each reuses the office's
// own rules, never a copy: Events' "Need people" (placeFree) and urgent gaps (urgentGap) over the
// booked count (bookedJoin), Enquiries' "need a person" (isEnquiry, needsPerson), Needs
// attention's lists, the Cancellations page's loader and its strike notice setting, the expiry
// scan's "renewed by a longer record" (supersededSql), Needs attention's "won't be in date for a
// booking" (its rule over every booking, outOfDateBookings, passed in) and the pay week
// (payWeekNow).
//
// Days are the firm's calendar days, each from its own midnight (startOfDay), never 24-hour steps:
// the clocks go back on Sun 25 Oct 2026.

export const CHART_ROWS = 50; // rows behind a chart's marks (`more`: there were others)
export const FILL_DAYS = 14; // places to fill: today and the 13 days after
export const EVENT_BARS = 8; // events that need people, and full events, named
export const CANCEL_DAYS = 14; // cancellations: today and the 13 days before
export const LICENCE_DAYS = 56; // licences: today and the 55 days after (8 weeks)

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const date = (v: string | Date) => new Date(v);

// ---------------------------------------------------------------------------------------------
// 1. Places to fill.

// Each firm day from `first` for `count` days: its places in open or filled sessions that start
// that day, those filled, those that can still be filled (placeFree) and the urgent gaps among them
// (urgentGap), in how many sessions the open places are, and how many of the open places casuals
// can't see (`hidden`: the session's switch or its event's is off; every session has an event).
// Every session of the day is counted, never only the rows a chart names. The places chart is from
// today for 14.
export async function loadDays(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  first: string,
  count: number,
): Promise<FillDay[]> {
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  const { rows } = await tx.execute<{
    day: string;
    places: number;
    filled: number;
    open: number;
    urgent: number;
    gap_sessions: number;
    hidden: number;
  }>(sql`
    select to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
           coalesce(sum(s.headcount), 0)::int as places,
           coalesce(sum(case when s.status = 'filled' then s.headcount else b.booked end), 0)::int
             as filled,
           coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)}), 0)::int as open,
           coalesce(sum(s.headcount - b.booked) filter (where ${urgentGap(now)}), 0)::int as urgent,
           (count(*) filter (where ${placeFree(now)}))::int as gap_sessions,
           coalesce(sum(s.headcount - b.booked) filter (
             where ${placeFree(now)} and not (s.showing_to_casuals and e.showing_to_casuals)
           ), 0)::int as hidden
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
     where s.status in ('open', 'filled')
       and s.starts_at >= ${startOfDay(first, timeZone)}
       and s.starts_at < ${startOfDay(addDays(first, count), timeZone)}
     group by 1
  `);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return days.map((d) => {
    const r = byDay.get(d);
    return {
      date: d,
      places: r?.places ?? 0,
      filled: r?.filled ?? 0,
      open: r?.open ?? 0,
      urgent: r?.urgent ?? 0,
      gapSessions: r?.gap_sessions ?? 0,
      hidden: r?.hidden ?? 0,
    };
  });
}

type GapSqlRow = {
  shift_id: string;
  event_id: string;
  event_name: string;
  event_showing: boolean;
  showing: boolean;
  role: string;
  day: string;
  starts_at: string | Date;
  ends_at: string | Date;
  headcount: number;
  booked: number;
  urgent_gap: boolean;
  source: string;
  site_name: string | null;
};

// The columns of a session with a place free, over `s` (with `e`, `b`, `si` and `esi`).
const gapColumns = (now: Date, timeZone: string) => sql`
  s.id::text as shift_id, s.event_id::text as event_id, e.name as event_name,
  e.showing_to_casuals as event_showing, s.showing_to_casuals as showing, s.role,
  to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, s.starts_at, s.ends_at,
  s.headcount, b.booked, ${urgentGap(now)} as urgent_gap, s.source,
  coalesce(si.name, esi.name) as site_name`;

const gapFrom = sql`
  from shifts s
  join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
  ${bookedJoin}
  left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
  left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id`;

// The rows with their offers (today.ts loadUrgentOffers: one query for them all).
async function withOffers(tx: FirmTx, rows: GapSqlRow[]): Promise<GapSession[]> {
  const offers = await loadUrgentOffers(
    tx,
    rows.map((r) => r.shift_id),
  );
  return rows.map((r) => {
    const o = offers.get(r.shift_id);
    return {
      shiftId: r.shift_id,
      eventId: r.event_id,
      eventName: r.event_name,
      site: r.site_name,
      role: r.role,
      date: r.day,
      startsAt: date(r.starts_at),
      endsAt: date(r.ends_at),
      headcount: r.headcount,
      booked: r.booked,
      placesFree: Math.max(0, r.headcount - r.booked),
      urgentGap: r.urgent_gap,
      hidden: !r.event_showing || !r.showing,
      eventShowing: r.event_showing,
      showing: r.showing,
      fromSheet: r.source === "sheets",
      fromPlanner: r.source === "api",
      offers: {
        offered: o?.offered ?? 0,
        waiting: o?.waiting ?? 0,
        declined: o?.declined ?? 0,
        accepted: o?.accepted ?? 0,
        stopped: o?.stopped ?? null,
      },
    };
  });
}

// The next 14 days: each day's places, and the window's sessions with a place free, soonest first.
export async function loadFill(tx: FirmTx, now: Date, timeZone: string): Promise<FillChart> {
  const first = localDateOf(now, timeZone);
  const days = await loadDays(tx, now, timeZone, first, FILL_DAYS);
  const { rows } = await tx.execute<GapSqlRow>(sql`
    select ${gapColumns(now, timeZone)}
      ${gapFrom}
     where ${placeFree(now)}
       and s.starts_at >= ${startOfDay(first, timeZone)}
       and s.starts_at < ${startOfDay(addDays(first, FILL_DAYS), timeZone)}
     order by s.starts_at, s.id
     limit ${CHART_ROWS + 1}
  `);
  return {
    first,
    days,
    gaps: await withOffers(tx, rows.slice(0, CHART_ROWS)),
    more: rows.length > CHART_ROWS,
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Which events need people.

// Over every session to come (not ended, not cancelled), as Events & sessions' "Need people"
// (eventViewCounts, loadEventCards): each event with a place free, its places, urgent gaps, hidden
// gaps and soonest gap, most urgent first; each with its sessions with a place free; how many
// more events need people; how many of every one have a gap casuals can't see (counted over all
// of them, never only the bars named); and the full ones by name.
export async function loadEventsNeed(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<EventsNeedChart> {
  const { rows } = await tx.execute<{
    event_id: string;
    name: string;
    showing: boolean;
    site_name: string | null;
    places: number;
    urgent: number;
    gap_sessions: number;
    hidden_sessions: boolean;
    first_gap: string | Date;
    events_total: number;
    places_total: number;
    urgent_total: number;
    hidden_total: number;
  }>(sql`
    with need as (
      select e.id, e.name, e.showing_to_casuals as showing, esi.name as site_name,
             coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)}), 0)::int
               as places,
             coalesce(sum(s.headcount - b.booked) filter (where ${urgentGap(now)}), 0)::int
               as urgent,
             (count(*) filter (where ${placeFree(now)}))::int as gap_sessions,
             coalesce(bool_or(${placeFree(now)} and not s.showing_to_casuals), false)
               as hidden_sessions,
             min(s.starts_at) filter (where ${placeFree(now)}) as first_gap
        from shift_events e
        join shifts s on s.firm_id = e.firm_id and s.event_id = e.id
        ${bookedJoin}
        left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
       where s.ends_at > ${now} and s.status <> 'cancelled'
       group by e.id, e.name, e.showing_to_casuals, esi.name
      having bool_or(${placeFree(now)})
    )
    select n.id::text as event_id, n.name, n.showing, n.site_name, n.places, n.urgent,
           n.gap_sessions, n.hidden_sessions, n.first_gap,
           (count(*) over ())::int as events_total,
           (sum(n.places) over ())::int as places_total,
           (sum(n.urgent) over ())::int as urgent_total,
           -- EventNeed.hidden's rule, over every event that needs people (before the limit).
           (count(*) filter (where not n.showing or n.hidden_sessions) over ())::int
             as hidden_total
      from need n
     order by n.urgent desc, n.places desc, n.first_gap, n.id
     limit ${EVENT_BARS}
  `);
  const ids = rows.map((r) => r.event_id);
  const { rows: sessionRows } =
    ids.length === 0
      ? { rows: [] as (GapSqlRow & { n: number })[] }
      : await tx.execute<GapSqlRow & { n: number }>(sql`
          select * from (
            select ${gapColumns(now, timeZone)},
                   row_number() over (partition by s.event_id order by s.starts_at, s.id) as n
              ${gapFrom}
             where ${placeFree(now)}
               and s.event_id in (${sql.join(
                 ids.map((id) => sql`${id}::uuid`),
                 sql`, `,
               )})
          ) x
           where x.n <= ${CHART_ROWS + 1}
           order by x.starts_at, x.shift_id
        `);
  const sessions = await withOffers(
    tx,
    sessionRows.filter((r) => Number(r.n) <= CHART_ROWS),
  );
  const over = new Set(sessionRows.filter((r) => Number(r.n) > CHART_ROWS).map((r) => r.event_id));
  const { rows: full } = await tx.execute<{ name: string; total: number }>(sql`
    select e.name, (count(*) over ())::int as total
      from shift_events e
      join shifts s on s.firm_id = e.firm_id and s.event_id = e.id
      ${bookedJoin}
     where s.ends_at > ${now} and s.status <> 'cancelled'
     group by e.id, e.name
    having not bool_or(${placeFree(now)})
       and bool_and(s.status = 'filled' or b.booked >= s.headcount)
     order by min(s.starts_at), e.id
     limit ${EVENT_BARS}
  `);
  const first = rows[0];
  return {
    events: rows.map((r): EventNeed => ({
      eventId: r.event_id,
      name: r.name,
      site: r.site_name,
      places: r.places,
      urgent: r.urgent,
      gapSessions: r.gap_sessions,
      firstGap: date(r.first_gap),
      showing: r.showing,
      hiddenSessions: r.hidden_sessions,
      hidden: !r.showing || r.hidden_sessions,
      sessions: sessions.filter((s) => s.eventId === r.event_id),
      moreSessions: over.has(r.event_id),
    })),
    more: Math.max(0, (first?.events_total ?? 0) - rows.length),
    total: {
      events: first?.events_total ?? 0,
      places: first?.places_total ?? 0,
      urgent: first?.urgent_total ?? 0,
    },
    hiddenEvents: first?.hidden_total ?? 0,
    full: full.map((f) => f.name),
    fullMore: Math.max(0, (full[0]?.total ?? 0) - full.length),
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Offers this week.

type OfferResponse = (typeof OFFER_RESPONSES)[number];
type ShiftStatus = (typeof SHIFT_STATUSES)[number];

// An offer's state, over the offer `o` and its session `s`: said yes; waiting for a reply (no
// answer, on a session still open and to come: an answer never runs out by itself); or closed. A
// failed one has none: it never counts as offered. offerState is the same rule in TypeScript
// (the integration tests check the two agree).
export const offerStateSql = (now: Date): SQL<OfferState | null> => sql`(case
  when o.response = 'failed' then null
  when o.response = 'accepted' then 'yes'
  when o.response is null and s.status = 'open' and s.starts_at > ${now} then 'waiting'
  else 'closed' end)`;

// Why a closed offer closed: said no, someone else took the place, the session was moved or
// cancelled (or put back to draft), or no answer before it started (or filled).
export const offerWhySql = (now: Date): SQL<OfferWhy | null> => sql`(case
  when o.response = 'declined' then 'said_no'
  when o.response = 'filled_elsewhere' then 'filled_elsewhere'
  when o.response = 'expired' then 'changed'
  when o.response is null and s.status in ('cancelled', 'draft') then 'changed'
  when o.response is null and not (s.status = 'open' and s.starts_at > ${now}) then 'no_reply'
  else null end)`;

export function offerState(
  o: { response: OfferResponse | null; shiftStatus: ShiftStatus; startsAt: Date },
  now: Date,
): { state: OfferState; why: OfferWhy | null } | null {
  if (o.response === "failed") return null;
  if (o.response === "accepted") return { state: "yes", why: null };
  const toCome = o.shiftStatus === "open" && o.startsAt.getTime() > now.getTime();
  if (o.response === null && toCome) return { state: "waiting", why: null };
  if (o.response === "declined") return { state: "closed", why: "said_no" };
  if (o.response === "filled_elsewhere") return { state: "closed", why: "filled_elsewhere" };
  if (o.response === "expired") return { state: "closed", why: "changed" };
  return {
    state: "closed",
    why: o.shiftStatus === "cancelled" || o.shiftStatus === "draft" ? "changed" : "no_reply",
  };
}

const OFFER_STATES: readonly OfferState[] = ["yes", "waiting", "closed"];
const OFFER_WHYS: readonly OfferWhy[] = ["said_no", "filled_elsewhere", "changed", "no_reply"];

// The offers sent in the pay week (Monday to Sunday, the firm's calendar), not failed: how many in
// each state (and why the closed ones closed), each state's newest, and the sessions still waiting.
export async function loadOffersWeek(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<OffersWeekChart> {
  const week = payWeekNow(now, timeZone);
  const from = startOfDay(week.monday, timeZone);
  const to = startOfDay(addDays(week.monday, 7), timeZone);
  const sent = sql`o.sent_at >= ${from} and o.sent_at < ${to}
    and o.response is distinct from 'failed'`;
  const { rows: counted } = await tx.execute<{
    state: OfferState;
    why: OfferWhy | null;
    n: number;
  }>(
    sql`
      select st.state, st.why, count(*)::int as n
        from offers o
        join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
        cross join lateral (select ${offerStateSql(now)} as state, ${offerWhySql(now)} as why) st
       where ${sent}
       group by 1, 2
    `,
  );
  const { rows } = await tx.execute<{
    offer_id: string;
    shift_id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
    role: string;
    event_name: string;
    starts_at: string | Date;
    sent_at: string | Date;
    responded_at: string | Date | null;
    by_office: boolean;
    state: OfferState;
    why: OfferWhy | null;
    n: number;
  }>(sql`
    select * from (
      select o.id::text as offer_id, o.shift_id::text as shift_id, o.worker_id::text as worker_id,
             w.first_name, w.last_name, s.role, e.name as event_name, s.starts_at, o.sent_at,
             o.responded_at, o.offered_by is not null as by_office, st.state, st.why,
             row_number() over (partition by st.state order by o.sent_at desc, o.id) as n
        from offers o
        join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
        join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
        cross join lateral (select ${offerStateSql(now)} as state, ${offerWhySql(now)} as why) st
       where ${sent}
    ) x
     where x.n <= ${CHART_ROWS + 1}
     order by x.sent_at desc, x.offer_id
  `);
  const { rows: waiting } = await tx.execute<{
    shift_id: string;
    role: string;
    event_name: string;
    starts_at: string | Date;
    ends_at: string | Date;
    waiting: number;
  }>(sql`
    select s.id::text as shift_id, s.role, e.name as event_name, s.starts_at, s.ends_at,
           count(*)::int as waiting
      from offers o
      join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where ${sent} and ${offerStateSql(now)} = 'waiting'
     group by s.id, s.role, e.name, s.starts_at, s.ends_at
     order by waiting desc, s.starts_at, s.id
     limit ${CHART_ROWS + 1}
  `);
  const counts = Object.fromEntries(OFFER_STATES.map((k) => [k, 0])) as Record<OfferState, number>;
  const closedWhy = Object.fromEntries(OFFER_WHYS.map((k) => [k, 0])) as Record<OfferWhy, number>;
  for (const c of counted) {
    counts[c.state] += c.n;
    if (c.state === "closed" && c.why) closedWhy[c.why] += c.n;
  }
  const toRow = (r: (typeof rows)[number]): OfferRow => ({
    offerId: r.offer_id,
    shiftId: r.shift_id,
    workerId: r.worker_id,
    casual: `${r.first_name} ${r.last_name}`,
    role: r.role,
    eventName: r.event_name,
    startsAt: date(r.starts_at),
    sentAt: date(r.sent_at),
    answeredAt: r.responded_at ? date(r.responded_at) : null,
    byOffice: r.by_office,
    state: r.state,
    why: r.why,
  });
  const of = (state: OfferState) => rows.filter((r) => r.state === state);
  return {
    week: { monday: week.monday, sunday: week.sunday },
    counts,
    closedWhy,
    rows: {
      yes: of("yes")
        .filter((r) => Number(r.n) <= CHART_ROWS)
        .map(toRow),
      waiting: of("waiting")
        .filter((r) => Number(r.n) <= CHART_ROWS)
        .map(toRow),
      closed: of("closed")
        .filter((r) => Number(r.n) <= CHART_ROWS)
        .map(toRow),
    },
    more: {
      yes: of("yes").length > CHART_ROWS,
      waiting: of("waiting").length > CHART_ROWS,
      closed: of("closed").length > CHART_ROWS,
    },
    waitingSessions: waiting.slice(0, CHART_ROWS).map((w): WaitingSession => ({
      shiftId: w.shift_id,
      role: w.role,
      eventName: w.event_name,
      startsAt: date(w.starts_at),
      endsAt: date(w.ends_at),
      waiting: w.waiting,
    })),
    waitingSessionsMore: waiting.length > CHART_ROWS,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. How long things have waited.

const WAITED_KINDS: readonly WaitedKind[] = [
  "to-mark",
  "uploads",
  "enquiries",
  "evidence",
  "planner-refused",
  "webhook",
];

// What needs the office and since when, from Needs attention's own items (`needs`, already read,
// so the chart and the menu's count agree), every waiting upload and every enquiry that needs a
// person counted by the day it came; the items with no date of their own as counts; and, only for
// a role that can open Pay (`pay`), the pay queries with payroll (never their details).
export async function loadWaited(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  o: { needs: NeedsAttention; needsMore: boolean; pay: boolean },
): Promise<WaitedChart> {
  const { needs } = o;
  const day = (at: Date) => localDateOf(at, timeZone);
  const uploadDays = await waitingUploadDays(tx, timeZone);
  const { since } = await enquiryWindow(tx, now);
  const { rows: enquiryDays } = await tx.execute<{ day: string; n: number }>(sql`
    select to_char(m.created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*)::int as n
      from messages m
     where ${isEnquiry("m", since)} and ${needsPerson("m")}
     group by 1
  `);
  // The first 50 that need a person, oldest first (Enquiries' "Need a person" order): who sent
  // each, as Enquiries names them (a casual, a number nobody here has, or a withheld number), and
  // never their words or their number (no panel shows either, so neither is read).
  const { rows: enquiryRows } = await tx.execute<{
    id: string;
    created_at: string | Date;
    channel: "whatsapp" | "sms" | "voice";
    worker_id: string | null;
    first_name: string | null;
    last_name: string | null;
    has_number: boolean;
  }>(sql`
    select m.id::text as id, m.created_at, m.channel, m.worker_id::text as worker_id,
           w.first_name, w.last_name, m.from_e164 is not null as has_number
      from messages m
      left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
     where ${isEnquiry("m", since)} and ${needsPerson("m")}
     order by m.created_at, m.id
     limit ${CHART_ROWS + 1}
  `);

  const items: WaitedItem[] = [
    ...[...needs.toMark]
      .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
      .map((t): WaitedItem => ({
        kind: "to-mark",
        since: t.endsAt,
        day: day(t.endsAt),
        shiftId: t.shiftId,
        role: t.role,
        site: t.site,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        unmarked: t.unmarked,
      })),
    ...needs.uploadList.map((u): WaitedItem => ({
      kind: "uploads",
      since: u.sentAt,
      day: day(u.sentAt),
      uploadId: u.id,
      workerId: u.workerId,
      casual: u.name,
      upload: u.kind,
      qualificationName: u.qualificationName,
    })),
    ...enquiryRows.slice(0, CHART_ROWS).map((m): WaitedItem => ({
      kind: "enquiries",
      since: date(m.created_at),
      day: day(date(m.created_at)),
      messageId: m.id,
      channel: m.channel,
      who:
        m.worker_id !== null && m.first_name !== null
          ? {
              kind: "casual",
              workerId: m.worker_id,
              name: `${m.first_name} ${m.last_name ?? ""}`.trim(),
            }
          : { kind: m.has_number ? "unknown" : "withheld" },
    })),
    ...[...needs.evidence.failed]
      .sort((a, b) => a.cancelledAt.getTime() - b.cancelledAt.getTime())
      .map((f): WaitedItem => ({
        kind: "evidence",
        since: f.cancelledAt,
        day: day(f.cancelledAt),
        assignmentId: f.assignmentId,
        casual: f.casual,
        stuck: f.stuck,
        nothingSent: f.nothingSent,
      })),
    ...[...needs.plannerRefused]
      .sort((a, b) => a.refusedAt.getTime() - b.refusedAt.getTime())
      .map((p): WaitedItem => ({
        kind: "planner-refused",
        since: p.refusedAt,
        day: day(p.refusedAt),
        shiftId: p.shiftId,
        role: p.role,
        site: p.site,
        startsAt: p.startsAt,
        why: p.why,
        casuals: p.casuals,
      })),
    ...(needs.webhookFailing
      ? [
          {
            kind: "webhook",
            since: needs.webhookFailing.since,
            day: day(needs.webhookFailing.since),
          } satisfies WaitedItem,
        ]
      : []),
  ];

  let pay: WaitedChart["pay"] = null;
  if (o.pay) {
    const { rows: queries } = await tx.execute<{
      id: string;
      worker_id: string;
      first_name: string;
      last_name: string;
      issue_type: PayIssue;
      work_date: string;
      created_at: string | Date;
      status: "open" | "in_digest";
    }>(sql`
      select q.id::text as id, q.worker_id::text as worker_id, w.first_name, w.last_name,
             q.issue_type, q.work_date::text as work_date, q.created_at, q.status
        from pay_queries q
        join workers w on w.firm_id = q.firm_id and w.id = q.worker_id
       where q.status in ('open', 'in_digest')
       order by q.created_at, q.id
       limit ${CHART_ROWS + 1}
    `);
    const { rows: byDay } = await tx.execute<{ day: string; n: number }>(sql`
      select to_char(q.created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
             count(*)::int as n
        from pay_queries q
       where q.status in ('open', 'in_digest')
       group by 1
       order by 1
    `);
    pay = {
      total: byDay.reduce((n, d) => n + Number(d.n), 0),
      days: byDay.map((d) => ({ day: d.day, count: Number(d.n) })),
      rows: queries.slice(0, CHART_ROWS).map((q): PayWaitingRow => ({
        payQueryId: q.id,
        workerId: q.worker_id,
        casual: `${q.first_name} ${q.last_name}`,
        issue: q.issue_type,
        workDate: q.work_date,
        since: date(q.created_at),
        day: day(date(q.created_at)),
        inDigest: q.status === "in_digest",
      })),
      more: queries.length > CHART_ROWS,
    };
  }

  // Every day something has waited since: the full counts of uploads and enquiries, and Needs
  // attention's own items of the other kinds.
  const days = new Map<string, WaitedDay>();
  const at = (d: string): WaitedDay => {
    let w = days.get(d);
    if (!w) {
      w = {
        day: d,
        needsYou: Object.fromEntries(WAITED_KINDS.map((k) => [k, 0])) as Record<WaitedKind, number>,
      };
      days.set(d, w);
    }
    return w;
  };
  for (const i of items) {
    if (i.kind !== "uploads" && i.kind !== "enquiries") at(i.day).needsYou[i.kind] += 1;
  }
  for (const u of uploadDays) at(u.day).needsYou.uploads += u.count;
  for (const e of enquiryDays) at(e.day).needsYou.enquiries += Number(e.n);

  const undated = {
    toCheck: needs.toCheck.length,
    fromSheet: needs.fromSheet.length,
    expired: needs.expired.length,
    strikesAddress: needs.evidence.addressConfirmed ? 0 : 1,
  };
  const ordered = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const dated = ordered.reduce(
    (n, d) => n + WAITED_KINDS.reduce((m, k) => m + d.needsYou[k], 0),
    0,
  );
  return {
    today: localDateOf(now, timeZone),
    days: ordered,
    items,
    more: {
      "to-mark": needs.toMarkMore,
      uploads: needs.uploads > needs.uploadList.length,
      enquiries: enquiryRows.length > CHART_ROWS,
      evidence: needs.evidence.failedMore,
      "planner-refused": needs.plannerRefusedMore,
      webhook: false,
    },
    undated,
    needsYouTotal:
      dated + undated.toCheck + undated.fromSheet + undated.expired + undated.strikesAddress,
    needsYouMore: o.needsMore,
    pay,
  };
}

// ---------------------------------------------------------------------------------------------
// 5. Cancellations, the last 14 days.

// Each firm day from 13 days ago to now: its cancellations (by anyone, each on the day it was
// made), those under the strike notice setting (`threshold`: the Cancellations page's "Under N
// hours", the dashboard's count's), and the window's rows as the Cancellations page loads them.
export async function loadCancels14(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  threshold: number,
): Promise<CancelsChart> {
  const today = localDateOf(now, timeZone);
  const first = addDays(today, -(CANCEL_DAYS - 1));
  const since = startOfDay(first, timeZone);
  const { rows } = await tx.execute<{
    day: string;
    total: number;
    short: number;
    by_casuals: number;
  }>(sql`
    select to_char(a.cancelled_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
           count(*)::int as total,
           count(*) filter (where a.notice_hours < ${threshold})::int as short,
           count(*) filter (where a.status = 'cancelled_worker')::int as by_casuals
      from assignments a
     where a.status in (${CANCELLED}) and a.cancelled_at >= ${since} and a.cancelled_at <= ${now}
     group by 1
  `);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const list = await loadCancellations(tx, {
    view: "all",
    now,
    limit: CHART_ROWS,
    since,
    until: now,
  });
  return {
    first,
    days: Array.from({ length: CANCEL_DAYS }, (_, i): CancelDay => {
      const d = addDays(first, i);
      const r = byDay.get(d);
      return {
        date: d,
        total: r?.total ?? 0,
        short: r?.short ?? 0,
        byCasuals: r?.by_casuals ?? 0,
      };
    }),
    threshold,
    rows: list.rows,
    more: list.total > list.rows.length,
  };
}

// ---------------------------------------------------------------------------------------------
// 6. Licences running out.

// Checked, valid records of active casuals (not erased) running out from today to 55 days on (the
// firm's calendar), not renewed by a longer valid record (supersededSql, the expiry scan's) and not
// with a suspended record of the type; whether a renewal waits for a check; and the soonest booking
// it won't be in date for. That comes from Needs attention's own rule (`outOfDate`: the rows of
// dashboard.ts outOfDateBookings, passed in), over every booking: never Needs attention's list,
// which stops at 50. Such a booking ends after the licence runs out (the rule lists it only when no
// checked record of the type is in date by the session's last day, this one included), so it comes
// with that last day (`lastDay`, the rule's own last_day): a night session can start on the day the
// licence runs out and end the day after.
export async function loadLicences(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  outOfDate: SQL,
): Promise<LicencesChart> {
  const today = localDateOf(now, timeZone);
  const last = addDays(today, LICENCE_DAYS - 1);
  const soonLast = addDays(today, EXPIRING_SOON_DAYS);
  const from = sql`
    from credentials c
    join workers w on w.firm_id = c.firm_id and w.id = c.worker_id`;
  const where = sql`
   where w.status = 'active' and w.erased_at is null
     and c.check_state = 'verified' and c.status = 'valid'
     and c.expires_on >= ${today}::date and c.expires_on <= ${last}::date
     and not ${supersededSql("c")}
     and not exists (select 1 from credentials x
                      where x.firm_id = c.firm_id and x.worker_id = c.worker_id
                        and x.type = c.type and x.check_state = 'verified'
                        and x.status = 'suspended')`;
  // The licence's casual is booked on a session it won't be in date for (`o`: outOfDate's rows).
  const itsOwn = sql`o.firm_id = c.firm_id and o.worker_id = c.worker_id and o.type = c.type`;
  const { rows: counted } = await tx.execute<{ total: number; soon: number; booked: number }>(sql`
    with out_of_date as (${outOfDate})
    select count(*)::int as total,
           count(*) filter (where c.expires_on <= ${soonLast}::date)::int as soon,
           count(*) filter (where exists (select 1 from out_of_date o where ${itsOwn}))::int
             as booked
      ${from}
      ${where}
  `);
  const { rows } = await tx.execute<{
    id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
    type: string;
    type_name: string | null;
    expires_on: string;
    renewal_waiting: boolean;
    booked_assignment_id: string | null;
    booked_shift_id: string | null;
    booked_role: string | null;
    booked_starts_at: string | Date | null;
    booked_last_day: string | null;
  }>(sql`
    with out_of_date as (${outOfDate})
    select c.id::text as id, c.worker_id::text as worker_id, w.first_name, w.last_name, c.type,
           (select ct.name from credential_types ct
             where ct.firm_id = c.firm_id and ct.code = c.type) as type_name,
           c.expires_on::text as expires_on,
           (exists (select 1 from credentials u
                     where u.firm_id = c.firm_id and u.worker_id = c.worker_id
                       and u.type = c.type and u.check_state = 'waiting')
            or exists (select 1 from uploads up
                        where up.firm_id = c.firm_id and up.worker_id = c.worker_id
                          and up.credential_type = c.type and up.status = 'waiting'))
             as renewal_waiting,
           bk.assignment_id as booked_assignment_id, bk.shift_id as booked_shift_id,
           bk.role as booked_role, bk.starts_at as booked_starts_at,
           bk.last_day as booked_last_day
      ${from}
      -- The soonest booking it won't be in date for, with the session's last day (the rule's).
      left join lateral (
        select o.assignment_id::text as assignment_id, o.shift_id::text as shift_id, o.role,
               o.starts_at, o.last_day::text as last_day
          from out_of_date o
         where ${itsOwn}
         order by o.starts_at, o.assignment_id
         limit 1
      ) bk on true
      ${where}
     order by c.expires_on, w.last_name, w.first_name, c.id
     limit ${CHART_ROWS + 1}
  `);
  const licences = rows.slice(0, CHART_ROWS).map((r): LicenceRow => {
    const days = daysUntil(today, r.expires_on);
    return {
      credentialId: r.id,
      workerId: r.worker_id,
      casual: `${r.first_name} ${r.last_name}`,
      type: r.type,
      name: r.type_name ?? r.type.replace(/_/g, " ").toLowerCase(),
      expiresOn: r.expires_on,
      days,
      soon: days <= EXPIRING_SOON_DAYS,
      renewalWaiting: r.renewal_waiting,
      booked:
        r.booked_assignment_id !== null &&
        r.booked_shift_id !== null &&
        r.booked_role !== null &&
        r.booked_starts_at !== null &&
        r.booked_last_day !== null
          ? {
              assignmentId: r.booked_assignment_id,
              shiftId: r.booked_shift_id,
              role: r.booked_role,
              startsAt: date(r.booked_starts_at),
              lastDay: r.booked_last_day,
            }
          : null,
    };
  });
  return {
    today,
    windowDays: LICENCE_DAYS,
    soonDays: EXPIRING_SOON_DAYS,
    rows: licences,
    more: rows.length > CHART_ROWS,
    counts: {
      total: counted[0]?.total ?? 0,
      soon: counted[0]?.soon ?? 0,
      booked: counted[0]?.booked ?? 0,
    },
  };
}
