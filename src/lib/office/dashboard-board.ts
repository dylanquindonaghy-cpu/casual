import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, type OFFER_CHANNELS } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { payCalendar, type PayCalendar } from "../pay/calendar";
import { payWeekNow } from "../pay/pay-week";
import { addDays, localDateOf, startOfDay, wallTimeOf, zonedToUtc } from "../time/zoned";
import { part, type Part } from "./dashboard";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { plannerLink, type PlannerLink } from "./integrations";
import { offerStateSql } from "./offer-state";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { loadToMark, type TodayToMark } from "./today";

// The office dashboard (Phase 24, 24.3: round 7 of the canvas, docs/mockups/phase-24/; docs/
// screens.md `/office`), one question: "which places still need people, and what happened while I
// was out?". Reads only, inside the firm (every query through the FirmTx: RLS scopes every row to
// it; joins on the composite keys), for admins and resourcers (checked here as well as on the
// page). Each part is read in a savepoint of its own (part()): one that fails shows its error and
// the rest of the page still shows.
//
// - The sessions with places to fill: Events & sessions' "Need people" (placeFree: open, not
//   started, a place free, over the booked count, bookedJoin), all of them or under the track's
//   filter: the urgent ones (urgentGap), this pay week's or next's (Monday to Sunday, the firm's
//   calendar). Each with its offers, and in one of the board's two columns: "Offered" while an
//   offer waits for a reply (offerStateSql, the rule the top bar's "Offers out" counts by), "To
//   offer" otherwise (never offered, or every offer answered or closed).
// - The track's counts: the sessions under each filter.
// - Places to fill by day over this pay week and next (from Monday, 14 days, each from its own
//   midnight: the clocks go back on Sun 25 Oct 2026), split the same way.
// - While you were out: the places casuals took themselves from offers between 18:00 and 08:00
//   (the last such night to have begun), still booked, with how the offer reached them and when
//   they said yes.
// - Who worked?: Needs attention's sessions to mark (today.ts loadToMark), so the two agree.
// - When the planner or rota sheet last sent changes (integrations.ts plannerLink).

export const BOARD_SHOWS = ["all", "urgent", "this-week", "next-week"] as const;
export type BoardShow = (typeof BOARD_SHOWS)[number];

// The track's filter from the address (`?show=`): anything else is "all".
export const boardShow = (raw: unknown): BoardShow =>
  (BOARD_SHOWS as readonly unknown[]).includes(raw) ? (raw as BoardShow) : "all";

export const BOARD_ROWS = 50; // sessions a column holds (`more`: there were others)
export const CHART_DAYS = 14; // this pay week and next
export const NIGHT_STARTS = 18; // "While you were out": from 18:00 ...
export const NIGHT_ENDS = 8; // ... to 08:00, the firm's clock

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const date = (v: string | Date) => new Date(v);

export interface BoardOffers {
  sent: number; // offers that went (never the failed ones)
  waiting: number; // no reply yet
  saidNo: number;
  tookIt: number;
  closed: number; // someone else took the place, or the session changed
  failed: number; // couldn't be sent
  waitingSince: Date | null; // the oldest offer still waiting
  waitingNames: string[]; // who hasn't replied, oldest offer first (the first two)
}

export interface BoardSession {
  shiftId: string;
  eventId: string;
  eventName: string;
  role: string;
  post: string | null;
  site: string | null; // the session's own site, or its event's
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  placesFree: number;
  urgent: boolean; // marked urgent (every session here has a place free, so it's an urgent gap)
  hidden: boolean; // its switch or its event's is off: casuals can't see it, so it can't be offered
  fromSheet: boolean;
  fromPlanner: boolean;
  offers: BoardOffers;
}

export interface BoardColumn {
  sessions: BoardSession[]; // soonest first, the first BOARD_ROWS
  total: number; // sessions in the column
  places: number; // their places to fill
  waiting: number; // their offers waiting for a reply
  more: boolean; // there were more than BOARD_ROWS
}

export interface ChartDay {
  date: string; // yyyy-mm-dd, the firm's calendar
  toOffer: number; // places to fill with no offer waiting
  offered: number; // places to fill with an offer waiting for a reply
}

export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export interface OvernightTake {
  offerId: string;
  shiftId: string;
  worker: string;
  role: string;
  eventName: string;
  startsAt: Date;
  endsAt: Date;
  answeredAt: Date; // when they said yes
  channel: OfferChannel; // how the offer reached them
}

export interface Board {
  timeZone: string;
  today: string; // yyyy-mm-dd, the firm's calendar
  payCalendar: PayCalendar; // its pay weeks or cycles (P3.1; Phase 25.2)
  now: Date;
  show: BoardShow;
  planner: Part<PlannerLink>;
  counts: Part<Record<BoardShow, number>>;
  chart: Part<{ first: string; days: ChartDay[] }>;
  // The two columns of places to fill, and the session the detail card shows: the one asked for
  // (`?session=`) while it has a place free, else the soonest urgent one under the filter, else the
  // soonest (null: none).
  gaps: Part<{ toOffer: BoardColumn; offered: BoardColumn; chosen: BoardSession | null }>;
  overnight: Part<{ from: Date; to: Date; takes: OvernightTake[]; more: boolean }>;
  toMark: Part<{ items: TodayToMark[]; more: boolean }>;
}

// This week's Monday and the Monday after next, in the firm's time zone: Monday to Sunday, whatever
// its pay calendar (a fortnight's cycle is for pay words only: Phase 25.2).
function weeks(now: Date, timeZone: string) {
  const monday = payWeekNow(now, timeZone).monday;
  return { monday, next: addDays(monday, 7), after: addDays(monday, CHART_DAYS) };
}

// The filter as a condition over `s` (with `b`).
function showSql(show: BoardShow, now: Date, timeZone: string): SQL {
  const w = weeks(now, timeZone);
  switch (show) {
    case "all":
      return sql`true`;
    case "urgent":
      return urgentGap(now);
    case "this-week":
      return sql`(s.starts_at >= ${startOfDay(w.monday, timeZone)}
                  and s.starts_at < ${startOfDay(w.next, timeZone)})`;
    case "next-week":
      return sql`(s.starts_at >= ${startOfDay(w.next, timeZone)}
                  and s.starts_at < ${startOfDay(w.after, timeZone)})`;
  }
}

// The night "While you were out" covers: from 18:00 on the day before to 08:00 (or now, while it
// lasts), or from 18:00 today once it's past 18:00. Each end is a wall time on its own day, so a
// night the clocks change in is as long as it really was.
export function lastNight(now: Date, timeZone: string): { from: Date; to: Date } {
  const today = localDateOf(now, timeZone);
  const at = (day: string, hour: number) => {
    const [year = 2000, month = 1, d = 1] = day.split("-").map(Number);
    return zonedToUtc({ year, month, day: d, hour, minute: 0 }, timeZone);
  };
  if (wallTimeOf(now, timeZone).hour >= NIGHT_STARTS)
    return { from: at(today, NIGHT_STARTS), to: now };
  const end = at(today, NIGHT_ENDS);
  return {
    from: at(addDays(today, -1), NIGHT_STARTS),
    to: end.getTime() < now.getTime() ? end : now,
  };
}

type GapRow = {
  shift_id: string;
  event_id: string;
  event_name: string;
  role: string;
  post: string | null;
  site_name: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  headcount: number;
  places_free: number;
  is_urgent: boolean;
  hidden: boolean;
  source: string;
  sent: number;
  waiting: number;
  said_no: number;
  took_it: number;
  closed: number;
  failed: number;
  waiting_since: string | Date | null;
  waiting_names: string[] | null;
};

// The sessions with a place free (placeFree) that `where` keeps, with their offers.
const gapSql = (now: Date, where: SQL) => sql`
  select s.id::text as shift_id, s.event_id::text as event_id, e.name as event_name, s.role,
         s.post, coalesce(si.name, esi.name) as site_name, s.starts_at, s.ends_at, s.headcount,
         (s.headcount - b.booked)::int as places_free, s.is_urgent,
         not (s.showing_to_casuals and e.showing_to_casuals) as hidden, s.source,
         o.sent, o.waiting, o.said_no, o.took_it, o.closed, o.failed, o.waiting_since,
         o.waiting_names
    from shifts s
    join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
    ${bookedJoin}
    left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
    left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
    cross join lateral (
      select count(*) filter (where o.response is distinct from 'failed')::int as sent,
             count(*) filter (where st.state = 'waiting')::int as waiting,
             count(*) filter (where o.response = 'declined')::int as said_no,
             count(*) filter (where o.response = 'accepted')::int as took_it,
             count(*) filter (where o.response in ('filled_elsewhere', 'expired'))::int as closed,
             count(*) filter (where o.response = 'failed')::int as failed,
             min(o.sent_at) filter (where st.state = 'waiting') as waiting_since,
             (array_agg(w.first_name || ' ' || w.last_name order by o.sent_at, o.id)
                filter (where st.state = 'waiting'))[1:2] as waiting_names
        from offers o
        join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
        cross join lateral (select ${offerStateSql(now)} as state) st
       where o.firm_id = s.firm_id and o.shift_id = s.id
    ) o
   where ${placeFree(now)} and ${where}`;

function toSession(r: GapRow): BoardSession {
  return {
    shiftId: r.shift_id,
    eventId: r.event_id,
    eventName: r.event_name,
    role: r.role,
    post: r.post,
    site: r.site_name,
    startsAt: date(r.starts_at),
    endsAt: date(r.ends_at),
    headcount: r.headcount,
    placesFree: r.places_free,
    urgent: r.is_urgent,
    hidden: r.hidden,
    fromSheet: r.source === "sheets",
    fromPlanner: r.source === "api",
    offers: {
      sent: r.sent,
      waiting: r.waiting,
      saidNo: r.said_no,
      tookIt: r.took_it,
      closed: r.closed,
      failed: r.failed,
      waitingSince: r.waiting_since ? date(r.waiting_since) : null,
      waitingNames: r.waiting_names ?? [],
    },
  };
}

// The two columns under the filter, soonest first: the first BOARD_ROWS of each, with each
// column's totals over all of its sessions.
async function loadGaps(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  show: BoardShow,
  asked: string | null,
): Promise<{ toOffer: BoardColumn; offered: BoardColumn; chosen: BoardSession | null }> {
  const { rows } = await tx.execute<
    GapRow & { n: number; total: number; places: number; waiting_total: number }
  >(sql`
    select * from (
      select g.*,
             row_number() over (partition by g.waiting > 0 order by g.starts_at, g.shift_id)::int
               as n,
             (count(*) over (partition by g.waiting > 0))::int as total,
             (sum(g.places_free) over (partition by g.waiting > 0))::int as places,
             (sum(g.waiting) over (partition by g.waiting > 0))::int as waiting_total
        from (${gapSql(now, showSql(show, now, timeZone))}) g
    ) x
     where x.n <= ${BOARD_ROWS}
     order by x.starts_at, x.shift_id
  `);
  const column = (offered: boolean): BoardColumn => {
    const mine = rows.filter((r) => r.waiting > 0 === offered);
    const first = mine[0];
    return {
      sessions: mine.map(toSession),
      total: first?.total ?? 0,
      places: first?.places ?? 0,
      waiting: first?.waiting_total ?? 0,
      more: (first?.total ?? 0) > mine.length,
    };
  };
  const toOffer = column(false);
  const offered = column(true);
  const shown = [...toOffer.sessions, ...offered.sessions].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.shiftId.localeCompare(b.shiftId),
  );
  let chosen: BoardSession | null = null;
  if (asked !== null) {
    chosen = shown.find((s) => s.shiftId === asked) ?? null;
    if (!chosen) {
      // Asked for one the columns don't hold (another filter's, or past the first 50).
      const { rows: one } = await tx.execute<GapRow>(gapSql(now, sql`s.id = ${asked}::uuid`));
      chosen = one[0] ? toSession(one[0]) : null;
    }
  }
  chosen ??= shown.find((s) => s.urgent) ?? shown[0] ?? null;
  return { toOffer, offered, chosen };
}

async function loadCounts(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<Record<BoardShow, number>> {
  const { rows } = await tx.execute<Record<"every" | "urgent" | "this_week" | "next_week", number>>(
    sql`
      select count(*)::int as every,
             (count(*) filter (where ${showSql("urgent", now, timeZone)}))::int as urgent,
             (count(*) filter (where ${showSql("this-week", now, timeZone)}))::int as this_week,
             (count(*) filter (where ${showSql("next-week", now, timeZone)}))::int as next_week
        from shifts s
        ${bookedJoin}
       where ${placeFree(now)}
    `,
  );
  const r = rows[0];
  return {
    all: r?.every ?? 0,
    urgent: r?.urgent ?? 0,
    "this-week": r?.this_week ?? 0,
    "next-week": r?.next_week ?? 0,
  };
}

// Each firm day of this pay week and next: its places to fill, with an offer waiting and without.
async function loadChart(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<{ first: string; days: ChartDay[] }> {
  const w = weeks(now, timeZone);
  const { rows } = await tx.execute<{ day: string; to_offer: number; offered: number }>(sql`
    select to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
           coalesce(sum(s.headcount - b.booked) filter (where not w.waiting), 0)::int as to_offer,
           coalesce(sum(s.headcount - b.booked) filter (where w.waiting), 0)::int as offered
      from shifts s
      ${bookedJoin}
      cross join lateral (
        select exists (select 1 from offers o
                        where o.firm_id = s.firm_id and o.shift_id = s.id
                          and ${offerStateSql(now)} = 'waiting') as waiting
      ) w
     where ${placeFree(now)}
       and s.starts_at >= ${startOfDay(w.monday, timeZone)}
       and s.starts_at < ${startOfDay(w.after, timeZone)}
     group by 1
  `);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return {
    first: w.monday,
    days: Array.from({ length: CHART_DAYS }, (_, i) => {
      const day = addDays(w.monday, i);
      const r = byDay.get(day);
      return { date: day, toOffer: r?.to_offer ?? 0, offered: r?.offered ?? 0 };
    }),
  };
}

// The places casuals took from offers last night (lastNight), still booked, latest first.
async function loadOvernight(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<{ from: Date; to: Date; takes: OvernightTake[]; more: boolean }> {
  const { from, to } = lastNight(now, timeZone);
  const { rows } = await tx.execute<{
    offer_id: string;
    shift_id: string;
    first_name: string;
    last_name: string;
    role: string;
    event_name: string;
    starts_at: string | Date;
    ends_at: string | Date;
    responded_at: string | Date;
    channel: OfferChannel;
  }>(sql`
    select o.id::text as offer_id, s.id::text as shift_id, w.first_name, w.last_name, s.role,
           e.name as event_name, s.starts_at, s.ends_at, o.responded_at, o.channel
      from offers o
      join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
     where o.response = 'accepted' and o.responded_at >= ${from} and o.responded_at < ${to}
       and exists (select 1 from assignments a
                    where a.firm_id = o.firm_id and a.shift_id = o.shift_id
                      and a.worker_id = o.worker_id and a.status not in (${CANCELLED}))
     order by o.responded_at desc, o.id
     limit ${BOARD_ROWS + 1}
  `);
  return {
    from,
    to,
    more: rows.length > BOARD_ROWS,
    takes: rows.slice(0, BOARD_ROWS).map((r) => ({
      offerId: r.offer_id,
      shiftId: r.shift_id,
      worker: `${r.first_name} ${r.last_name}`,
      role: r.role,
      eventName: r.event_name,
      startsAt: date(r.starts_at),
      endsAt: date(r.ends_at),
      answeredAt: date(r.responded_at),
      channel: r.channel,
    })),
  };
}

export async function loadBoard(
  tx: FirmTx,
  now: Date,
  opts: { show?: BoardShow; session?: string | null } = {},
): Promise<Board> {
  const { rows } = await tx.execute<{ timezone: string; settings: Record<string, unknown> }>(
    sql`select timezone, settings from firms where id = app_current_firm_id()`,
  );
  const timeZone = rows[0]?.timezone ?? "Europe/London";
  const show = opts.show ?? "all";
  const asked = z.uuid().safeParse(opts.session).success ? (opts.session as string) : null;
  return {
    timeZone,
    today: localDateOf(now, timeZone),
    payCalendar: payCalendar(rows[0]?.settings ?? {}),
    now,
    show,
    planner: await part(tx, "planner", (sp) => plannerLink(sp)),
    counts: await part(tx, "board counts", (sp) => loadCounts(sp, now, timeZone)),
    chart: await part(tx, "places chart", (sp) => loadChart(sp, now, timeZone)),
    gaps: await part(tx, "board gaps", (sp) => loadGaps(sp, now, timeZone, show, asked)),
    overnight: await part(tx, "while you were out", (sp) => loadOvernight(sp, now, timeZone)),
    toMark: await part(tx, "who worked", (sp) => loadToMark(sp, now)),
  };
}

// The dashboard for an admin or resourcer, or null (anyone else, or logged out).
export async function officeDashboard(
  ctx: OfficeContext,
  opts: { show?: BoardShow; session?: string | null } = {},
): Promise<Board | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "today")) ? loadBoard(tx, now, opts) : null,
  );
}
