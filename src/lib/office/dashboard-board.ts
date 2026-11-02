import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, type OFFER_CHANNELS } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { atOfferLimit } from "../offers/offer-limit";
import { payCalendar, type PayCalendar } from "../pay/calendar";
import { payWeekNow } from "../pay/pay-week";
import { addDays, localDateOf, startOfDay, wallTimeOf, zonedToUtc } from "../time/zoned";
import { part, type Part } from "./dashboard";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { plannerLink, type PlannerLink } from "./integrations";
import { offerStateSql } from "./offer-state";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import {
  loadTakers,
  loadUpdates,
  loadVenues,
  loadWhoWorked,
  type MapVenue,
  type Takers,
  type Update,
  type WhoWorkedGroup,
} from "./dashboard-map";
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
const WINDOW_DAYS = 14; // this pay week and next

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
  // The waves have offered it to the most casuals for its free places (Phase 25.3: offer-limit.ts).
  atLimit: boolean;
}

export interface BoardSession {
  shiftId: string;
  eventId: string;
  eventName: string;
  role: string;
  post: string | null;
  site: string | null; // the session's own site, or its event's
  siteId: string | null; // which venue that is (round 8: its pin on the map)
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  placesFree: number;
  payRatePence: number | null; // its pay an hour, if it has one (round 8's card)
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

export interface Board {
  timeZone: string;
  today: string; // yyyy-mm-dd, the firm's calendar
  payCalendar: PayCalendar; // its pay weeks or cycles (P3.1; Phase 25.2)
  now: Date;
  show: BoardShow;
  planner: Part<PlannerLink>;
  counts: Part<Record<BoardShow, number>>;
  // The two columns of places to fill, and the session the detail card shows: the one asked for
  // (`?session=`) while it has a place free, else the soonest urgent one under the filter, else the
  // soonest (null: none).
  gaps: Part<{ toOffer: BoardColumn; offered: BoardColumn; chosen: BoardSession | null }>;
  toMark: Part<{ items: TodayToMark[]; total: number }>;
  // Round 8 (Phase 26.2): the venue map (with "Show full venues" or not), who can take the chosen
  // session under the rules, Updates, and Who worked? by name (dashboard-map.ts).
  full: boolean;
  role: string | null; // Filter's role (one of `roles`), or every role
  roles: Part<string[]>; // the roles with places to fill (Filter's choices)
  venues: Part<MapVenue[]>;
  takers: Part<Takers> | null; // null: no session chosen
  updates: Part<{ items: Update[]; more: boolean }>;
  whoWorked: Part<WhoWorkedGroup[]>;
}

// This week's Monday and the Monday after next, in the firm's time zone: Monday to Sunday, whatever
// its pay calendar (a fortnight's cycle is for pay words only: Phase 25.2).
function weeks(now: Date, timeZone: string) {
  const monday = payWeekNow(now, timeZone).monday;
  return { monday, next: addDays(monday, 7), after: addDays(monday, WINDOW_DAYS) };
}

// The map's window: from now to the end of next pay week.
export function boardWindow(now: Date, timeZone: string): { to: Date } {
  return { to: startOfDay(weeks(now, timeZone).after, timeZone) };
}

// Filter's role as a condition over `s`: that role, or every one.
export const roleSql = (role: string | null): SQL => (role ? sql`s.role = ${role}` : sql`true`);

// The filter as a condition over `s` (with `b`).
export function showSql(show: BoardShow, now: Date, timeZone: string): SQL {
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

type GapRow = {
  shift_id: string;
  event_id: string;
  event_name: string;
  role: string;
  post: string | null;
  site_name: string | null;
  site_id: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  headcount: number;
  places_free: number;
  pay_rate_pence: number | null;
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
         s.post, coalesce(si.name, esi.name) as site_name,
         coalesce(s.site_id, e.site_id)::text as site_id, s.starts_at, s.ends_at, s.headcount,
         (s.headcount - b.booked)::int as places_free, s.pay_rate_pence, s.is_urgent,
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
    siteId: r.site_id,
    startsAt: date(r.starts_at),
    endsAt: date(r.ends_at),
    headcount: r.headcount,
    placesFree: r.places_free,
    payRatePence: r.pay_rate_pence,
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
      // Waves run only for an urgent session.
      atLimit: r.is_urgent && atOfferLimit(r.sent, r.places_free),
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
  role: string | null = null,
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
        from (${gapSql(now, sql`${showSql(show, now, timeZone)} and ${roleSql(role)}`)}) g
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
  role: string | null = null,
): Promise<Record<BoardShow, number>> {
  const { rows } = await tx.execute<Record<"every" | "urgent" | "this_week" | "next_week", number>>(
    sql`
      select count(*)::int as every,
             (count(*) filter (where ${showSql("urgent", now, timeZone)}))::int as urgent,
             (count(*) filter (where ${showSql("this-week", now, timeZone)}))::int as this_week,
             (count(*) filter (where ${showSql("next-week", now, timeZone)}))::int as next_week
        from shifts s
        ${bookedJoin}
       where ${placeFree(now)} and ${roleSql(role)}
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

// The roles with places to fill now (Filter's choices), A to Z.
async function loadRoles(tx: FirmTx, now: Date): Promise<string[]> {
  const { rows } = await tx.execute<{ role: string }>(sql`
    select distinct s.role from shifts s ${bookedJoin} where ${placeFree(now)} order by s.role
  `);
  return rows.map((r) => r.role);
}

export async function loadBoard(
  tx: FirmTx,
  now: Date,
  opts: { show?: BoardShow; session?: string | null; full?: boolean; role?: string | null } = {},
): Promise<Board> {
  const { rows } = await tx.execute<{ timezone: string; settings: Record<string, unknown> }>(
    sql`select timezone, settings from firms where id = app_current_firm_id()`,
  );
  const timeZone = rows[0]?.timezone ?? "Europe/London";
  const show = opts.show ?? "all";
  const full = opts.full === true;
  const asked = z.uuid().safeParse(opts.session).success ? (opts.session as string) : null;
  // Filter's role only when it's one with places to fill (anything else: every role).
  const roles = await part(tx, "roles", (sp) => loadRoles(sp, now));
  const role = roles.ok && opts.role && roles.data.includes(opts.role) ? opts.role : null;
  const gaps = await part(tx, "board gaps", (sp) => loadGaps(sp, now, timeZone, show, asked, role));
  const chosen = gaps.ok ? gaps.data.chosen : null;
  const toMark = await part(tx, "who worked", (sp) => loadToMark(sp, now));
  return {
    timeZone,
    today: localDateOf(now, timeZone),
    payCalendar: payCalendar(rows[0]?.settings ?? {}),
    now,
    show,
    planner: await part(tx, "planner", (sp) => plannerLink(sp)),
    counts: await part(tx, "board counts", (sp) => loadCounts(sp, now, timeZone, role)),
    gaps,
    toMark,
    full,
    role,
    roles,
    venues: await part(tx, "venue map", async (sp) => {
      const all = await loadVenues(sp, now, timeZone, show, role);
      return full ? all : all.filter((v) => v.places > 0);
    }),
    takers: chosen
      ? await part(tx, "who can take it", (sp) => loadTakers(sp, chosen.shiftId, now))
      : null,
    updates: await part(tx, "updates", (sp) => loadUpdates(sp, now)),
    whoWorked: toMark.ok
      ? await part(tx, "who worked by name", (sp) => loadWhoWorked(sp, toMark.data.items))
      : { ok: false },
  };
}

// The dashboard for an admin or resourcer, or null (anyone else, or logged out).
export async function officeDashboard(
  ctx: OfficeContext,
  opts: { show?: BoardShow; session?: string | null; full?: boolean; role?: string | null } = {},
): Promise<Board | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "today")) ? loadBoard(tx, now, opts) : null,
  );
}
