import { sql } from "drizzle-orm";
import { uuidArray } from "../db/arrays";
import type { FirmTx } from "../db/scoped";
import { officeOfferCandidates } from "../offers/office-offer";
import { hasTextSender } from "../portal/login-way";
import { localDateOf } from "../time/zoned";
import { sitesSql } from "./contract-scope";
import {
  type BoardScope,
  type BoardShow,
  boardWindow,
  EVERYWHERE,
  scopeSql,
  showSql,
} from "./dashboard-board";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { offerStateSql } from "./offer-state";
import type { TodayToMark } from "./today";
import { toMarkGroups } from "./to-mark";

// Round 8's dashboard (Phase 26.2; the spec page's "Dashboard", dash-1 to dash-9; the pre-build
// audit's aud-7 to aud-10): what the map, the session card, Updates and Who worked? show, read from
// the firm's own rows. Reads only, inside the firm (every query through the FirmTx: RLS scopes each
// row to it; joins on the composite keys). Nothing here decides anything: who can take a session
// is the rules' own list (officeOfferCandidates, the offer page's).
//
// - The venues on the map: each site with sessions to come in this pay week and next (the places
//   chart's 14 days until round 8) under the track's filter, its places to fill, whether a session
//   there is an urgent gap, whether every one with a place free is hidden from casuals, the days
//   with places, and where it is (the site's latitude and longitude, set from its postcode by the
//   geocoder or sent by the planner). A venue with nothing to fill shows only with "Show full
//   venues"; one with no position is listed under the map, never placed by guesswork (aud-8).
// - Who can take the chosen session: the rules' candidates now, and the one name when there's one.
// - Updates (dash-5): in the last two days, places casuals took, casuals' cancellations (their
//   notice, the strike, whether the place is open again) and photos and certificates waiting for a
//   check; and, as one line, every offer still waiting for a reply; newest first. Since Phase 27.9
//   the dashboard asks without the photos and certificates (`uploads: false`: they're a casual's,
//   not a contract's, and stay on Needs attention and the Updates page, which asks for every kind).
// - Who worked? by name (dash-6): the sessions to mark (today.ts loadToMark), alike ones together,
//   each with the people still booked (not marked); the column shows WHO_WORKED_GROUPS of them.

const date = (v: string | Date) => new Date(v);

export const UPDATES_SHOWN = 6;
export const UPDATES_HOURS = 48;
export { WHO_WORKED_GROUPS } from "./dashboard-map-copy";

export interface MapVenue {
  siteId: string;
  name: string;
  town: string | null;
  lat: number | null;
  lng: number | null;
  places: number; // places to fill, under the filter
  sessions: number; // its sessions to come in the window, under the filter
  urgent: boolean; // one of them is an urgent gap
  hidden: boolean; // each one with a place free is hidden from casuals
  days: string[]; // yyyy-mm-dd, the days with places to fill (soonest first)
  firstShiftId: string | null; // its soonest session with a place free: what its pin opens
}

export async function loadVenues(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  show: BoardShow,
  scope: BoardScope = EVERYWHERE,
): Promise<MapVenue[]> {
  const w = boardWindow(now, timeZone);
  const { rows } = await tx.execute<{
    site_id: string;
    name: string;
    town: string | null;
    lat: string | number | null;
    lng: string | number | null;
    places: number;
    sessions: number;
    urgent: boolean;
    hidden: boolean | null;
    days: string[] | null;
    first_shift: string | null;
  }>(sql`
    select v.id::text as site_id, v.name, v.town, v.lat, v.lng,
           coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)}), 0)::int as places,
           count(*)::int as sessions,
           coalesce(bool_or(${urgentGap(now)}), false) as urgent,
           bool_and(not (s.showing_to_casuals and e.showing_to_casuals))
             filter (where ${placeFree(now)}) as hidden,
           array_agg(distinct to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD'))
             filter (where ${placeFree(now)}) as days,
           (array_agg(s.id::text order by s.starts_at, s.id)
             filter (where ${placeFree(now)}))[1] as first_shift
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
      join sites v on v.firm_id = s.firm_id and v.id = coalesce(s.site_id, e.site_id)
     where s.status = 'open' and s.starts_at > ${now} and s.starts_at < ${w.to}
       and ${showSql(show, now, timeZone)} and ${scopeSql(scope, timeZone)}
     group by v.id
     order by urgent desc, places desc, v.name, v.id
  `);
  return rows.map((r) => ({
    siteId: r.site_id,
    name: r.name,
    town: r.town,
    lat: r.lat === null ? null : Number(r.lat),
    lng: r.lng === null ? null : Number(r.lng),
    places: r.places,
    sessions: r.sessions,
    urgent: r.urgent,
    hidden: r.places > 0 && r.hidden === true,
    days: [...(r.days ?? [])].sort(),
    firstShiftId: r.first_shift,
  }));
}

export interface Takers {
  count: number; // casuals the rules let the office offer it to now
  only: { workerId: string; name: string; hoursThisWeek: number } | null; // when there's one
}

export async function loadTakers(tx: FirmTx, shiftId: string, now: Date): Promise<Takers> {
  // Only those an offer can reach (Phase 26.9), as the offer page lists them.
  const list = (await officeOfferCandidates(tx, shiftId, now, hasTextSender())).filter(
    (c) => c.reach.how !== "none",
  );
  const one = list.length === 1 ? list[0]! : null;
  return {
    count: list.length,
    only: one ? { workerId: one.workerId, name: one.name, hoursThisWeek: one.hoursThisWeek } : null,
  };
}

export type Update =
  | {
      kind: "took";
      at: Date;
      shiftId: string;
      worker: string;
      role: string;
      site: string | null;
      startsAt: Date;
      placesFree: number;
      eventId?: string; // its event (Updates' event filter, Phase 36.2)
      event?: string; // the event's name
    }
  | {
      kind: "cancelled";
      at: Date;
      shiftId: string;
      ref: string; // the cancellation's own page
      worker: string;
      role: string;
      site: string | null;
      startsAt: Date;
      noticeHours: number;
      strike: "live" | "withdrawn" | null;
      reopened: boolean; // the place is open again (not filled since)
      eventId?: string;
      event?: string;
    }
  | {
      kind: "upload";
      at: Date;
      workerId: string;
      worker: string;
      what: "photo" | "certificate";
    }
  | {
      // Every offer still waiting for a reply, as one line (a line each crowded out the rest).
      kind: "no-reply";
      at: Date; // the newest of them
      oldest: Date;
      offers: number;
      sessions: number;
    };

export async function loadUpdates(
  tx: FirmTx,
  now: Date,
  // A person's contracts' venues (Phase 26.3; null: every venue). Uploads to check are a casual's,
  // not a venue's: they show whatever the contracts.
  mine: string[] | null = null,
  // The dashboard's column: the last two days, six shown, no uploads (Phase 27.9). The Updates page
  // (Phase 26.4): a week, every kind; since Phase 36.2 from the start of the period chosen
  // (`since`: today's midnight, or 3, 7 or 30 days back).
  opts: { hours?: number; since?: Date; shown?: number; uploads?: boolean } = {},
): Promise<{ items: Update[]; more: boolean }> {
  const hours = opts.hours ?? UPDATES_HOURS;
  const shown = opts.shown ?? UPDATES_SHOWN;
  const withUploads = opts.uploads ?? true;
  const since = opts.since ?? new Date(now.getTime() - hours * 3_600_000);
  const limit = shown + 1;
  const site = sql`coalesce(si.name, esi.name)`;
  const sites = sql`
    left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
    left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id`;
  const { rows: took } = await tx.execute<{
    at: string | Date;
    shift_id: string;
    first_name: string;
    last_name: string;
    role: string;
    site: string | null;
    starts_at: string | Date;
    places_free: number;
    event_id: string;
    event: string;
  }>(sql`
    select o.responded_at as at, s.id::text as shift_id, w.first_name, w.last_name, s.role,
           ${site} as site, s.starts_at, greatest(s.headcount - b.booked, 0)::int as places_free,
           e.id::text as event_id, e.name as event
      from offers o
      join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
      ${bookedJoin}
      ${sites}
     where o.response = 'accepted' and o.responded_at >= ${since} and o.responded_at <= ${now}
       and ${sitesSql(mine)}
     order by o.responded_at desc, o.id
     limit ${limit}
  `);
  const { rows: cancelled } = await tx.execute<{
    at: string | Date;
    shift_id: string;
    assignment_id: string;
    first_name: string;
    last_name: string;
    role: string;
    site: string | null;
    starts_at: string | Date;
    notice_hours: string | number;
    strike: "live" | "withdrawn" | null;
    reopened: boolean;
    event_id: string;
    event: string;
  }>(sql`
    select a.cancelled_at as at, s.id::text as shift_id, a.id::text as assignment_id,
           w.first_name, w.last_name, s.role, ${site} as site, s.starts_at, a.notice_hours,
           e.id::text as event_id, e.name as event,
           (select st.status from strikes st
             where st.firm_id = a.firm_id and st.assignment_id = a.id
             order by st.issued_at desc limit 1) as strike,
           (s.status = 'open' and s.starts_at > ${now} and b.booked < s.headcount) as reopened
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      ${bookedJoin}
      ${sites}
     where a.status = 'cancelled_worker' and a.cancelled_at >= ${since} and ${sitesSql(mine)}
       and a.cancelled_at <= ${now}
     order by a.cancelled_at desc, a.id
     limit ${limit}
  `);
  type UploadRow = {
    at: string | Date;
    worker_id: string;
    first_name: string;
    last_name: string;
    kind: "photo" | "certificate";
  };
  const { rows: uploads } = withUploads
    ? await tx.execute<UploadRow>(sql`
        select u.created_at as at, w.id::text as worker_id, w.first_name, w.last_name, u.kind
          from uploads u
          join workers w on w.firm_id = u.firm_id and w.id = u.worker_id
         where u.status = 'waiting' and u.created_at >= ${since} and u.created_at <= ${now}
         order by u.created_at desc, u.id
         limit ${limit}
      `)
    : { rows: [] as UploadRow[] };
  const { rows: noReply } = await tx.execute<{
    newest: string | Date | null;
    oldest: string | Date | null;
    offers: number;
    sessions: number;
  }>(sql`
    select max(o.sent_at) as newest, min(o.sent_at) as oldest, count(*)::int as offers,
           count(distinct s.id)::int as sessions
      from offers o
      join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
      ${bookedJoin}
     where ${offerStateSql(now)} = 'waiting' and ${placeFree(now)} and ${sitesSql(mine)}
  `);
  const name = (r: { first_name: string; last_name: string }) => `${r.first_name} ${r.last_name}`;
  const items: Update[] = [
    ...took.map((r): Update => ({
      kind: "took",
      at: date(r.at),
      shiftId: r.shift_id,
      worker: name(r),
      role: r.role,
      site: r.site,
      startsAt: date(r.starts_at),
      placesFree: r.places_free,
      eventId: r.event_id,
      event: r.event,
    })),
    ...cancelled.map((r): Update => ({
      kind: "cancelled",
      at: date(r.at),
      shiftId: r.shift_id,
      ref: r.assignment_id,
      worker: name(r),
      role: r.role,
      site: r.site,
      startsAt: date(r.starts_at),
      noticeHours: Number(r.notice_hours),
      strike: r.strike,
      reopened: r.reopened,
      eventId: r.event_id,
      event: r.event,
    })),
    ...uploads.map((r): Update => ({
      kind: "upload",
      at: date(r.at),
      workerId: r.worker_id,
      worker: name(r),
      what: r.kind,
    })),
    ...noReply
      .filter((r) => r.offers > 0 && r.newest && r.oldest)
      .map((r): Update => ({
        kind: "no-reply",
        at: date(r.newest!),
        oldest: date(r.oldest!),
        offers: r.offers,
        sessions: r.sessions,
      })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: items.slice(0, shown), more: items.length > shown };
}

// Who worked?'s groups: Needs attention's sessions to mark, alike ones together (one role, place
// and time: sessions copied from a sheet often come several alike; to-mark.ts, as round 7's cards),
// the first three, each person still booked on any of them by name, with their own session.
export interface WhoWorkedGroup {
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  shiftIds: string[]; // the alike sessions, one or more
  people: { shiftId: string; workerId: string; name: string }[]; // still booked, not marked
}

export async function loadWhoWorked(tx: FirmTx, toMark: TodayToMark[]): Promise<WhoWorkedGroup[]> {
  // Every group (Needs attention's first 50 sessions): the column shows the first few, the rest
  // with "Show all" (Phase 26.4: Who worked? is the dashboard's alone).
  const groups = toMarkGroups(toMark);
  if (groups.length === 0) return [];
  const ids = groups.flatMap((g) => g.sessions.map((m) => m.shiftId));
  const { rows } = await tx.execute<{
    shift_id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
  }>(sql`
    select a.shift_id::text as shift_id, w.id::text as worker_id, w.first_name, w.last_name
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
     where a.status = 'confirmed' and a.shift_id = any(${uuidArray(ids)})
     order by w.first_name, w.last_name, w.id, a.shift_id
  `);
  return groups.map((g) => {
    const shiftIds = g.sessions.map((m) => m.shiftId);
    return {
      role: g.role,
      site: g.site,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      shiftIds,
      people: rows
        .filter((r) => shiftIds.includes(r.shift_id))
        .map((r) => ({
          shiftId: r.shift_id,
          workerId: r.worker_id,
          name: `${r.first_name} ${r.last_name}`,
        })),
    };
  });
}

export const dayOf = (at: Date, timeZone: string) => localDateOf(at, timeZone);
