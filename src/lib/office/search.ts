import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { normaliseMobile } from "../auth/mobile";
import type { FirmTx } from "../db/scoped";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { searchHits, type SearchHits } from "./search-copy";

// The office's search (Phase 24: the top bar's "Find a casual, shift or site"; docs/ui-design.md
// "Office shell"). What's typed reaches the server as an action, never the address or a log (as the
// Casuals page's own search: src/app/office/find-worker-form.tsx). Each kind only for a role that
// can open it: casuals (not deleted) by name or mobile number, for Casuals' roles; sessions to come
// (not ended, not cancelled) by role, event, site or post, and sites by name or town, for Events &
// sessions' roles. Up to SEARCH_MAX of each (`more`: there were others), in the firm's own
// transaction, so another firm's rows are never read. Reads only.

export const SEARCH_MAX = 5;
export const SEARCH_MIN = 2; // characters, so one letter doesn't list half the firm
export const SEARCH_LONGEST = 100;

export type WorkerStatus = "active" | "inactive" | "blocked";

export interface CasualFound {
  id: string;
  firstName: string;
  lastName: string;
  roles: string[];
  status: WorkerStatus;
}

export interface SessionFound {
  id: string;
  role: string;
  event: string;
  place: string | null; // the session's site, else its event's
  post: string | null;
  startsAt: Date;
  endsAt: Date;
  placesFree: number; // 0 unless it's open, to come and not full
  urgentGap: boolean;
}

export interface SiteFound {
  id: string;
  name: string;
  town: string | null;
  events: number; // events with a session to come there
}

export interface Found<T> {
  rows: T[];
  more: boolean;
}

export interface SearchFound {
  casuals: Found<CasualFound> | null; // null: this role can't open Casuals
  sessions: Found<SessionFound> | null; // null: this role can't open Events & sessions
  sites: Found<SiteFound> | null;
}

// What's typed, as it's searched: trimmed, at most SEARCH_LONGEST characters; null when too short.
export function searchQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, SEARCH_LONGEST);
  return q.length >= SEARCH_MIN ? q : null;
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const found = <T>(rows: T[]): Found<T> => ({
  rows: rows.slice(0, SEARCH_MAX),
  more: rows.length > SEARCH_MAX,
});

export async function findCasuals(tx: FirmTx, q: string): Promise<Found<CasualFound>> {
  const mobile = normaliseMobile(q);
  const { rows } = await tx.execute<{
    id: string;
    first_name: string;
    last_name: string;
    roles: string[];
    status: WorkerStatus;
  }>(sql`
    select w.id, w.first_name, w.last_name, w.roles, w.status
      from workers w
     where w.erased_at is null
       and ${
         mobile
           ? sql`w.mobile_e164 = ${mobile}`
           : sql`(w.first_name || ' ' || w.last_name) ilike ${likeOf(q)}`
       }
     order by w.last_name, w.first_name, w.id
     limit ${SEARCH_MAX + 1}
  `);
  return found(
    rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      roles: r.roles,
      status: r.status,
    })),
  );
}

export async function findSessions(tx: FirmTx, q: string, now: Date): Promise<Found<SessionFound>> {
  const like = likeOf(q);
  const { rows } = await tx.execute<{
    id: string;
    role: string;
    event: string;
    place: string | null;
    post: string | null;
    starts_at: string | Date;
    ends_at: string | Date;
    places_free: number;
    urgent_gap: boolean;
  }>(sql`
    select s.id, s.role, e.name as event, coalesce(si.name, esi.name) as place, s.post,
           s.starts_at, s.ends_at,
           (case when ${placeFree(now)} then s.headcount - b.booked else 0 end)::int as places_free,
           ${urgentGap(now)} as urgent_gap
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
     where s.ends_at > ${now} and s.status <> 'cancelled'
       and (replace(s.role, '_', ' ') ilike ${like} or e.name ilike ${like}
            or coalesce(si.name, esi.name) ilike ${like} or s.post ilike ${like})
     order by s.starts_at, s.role, s.id
     limit ${SEARCH_MAX + 1}
  `);
  return found(
    rows.map((r) => ({
      id: r.id,
      role: r.role,
      event: r.event,
      place: r.place,
      post: r.post,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      placesFree: Math.max(0, r.places_free),
      urgentGap: r.urgent_gap,
    })),
  );
}

export async function findSites(tx: FirmTx, q: string, now: Date): Promise<Found<SiteFound>> {
  const like = likeOf(q);
  const { rows } = await tx.execute<{
    id: string;
    name: string;
    town: string | null;
    events: number;
  }>(sql`
    select si.id, si.name, si.town,
           (select count(distinct e.id)::int
              from shift_events e
              join shifts s on s.firm_id = e.firm_id and s.event_id = e.id
             where (e.site_id = si.id or s.site_id = si.id)
               and s.ends_at > ${now} and s.status <> 'cancelled') as events
      from sites si
     where si.name ilike ${like} or si.town ilike ${like}
     order by si.name, si.id
     limit ${SEARCH_MAX + 1}
  `);
  return found(rows.map((r) => ({ id: r.id, name: r.name, town: r.town, events: r.events })));
}

// Everything the office user in `ctx` may find for `raw`: null when they can open neither Casuals
// nor Events & sessions (payroll); each kind empty when what's typed is too short.
export async function officeSearch(ctx: OfficeContext, raw: string): Promise<SearchFound | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  const q = searchQuery(raw);
  return run(ctx.firm.id, async (tx) => {
    const casuals = await officeUserMay(tx, ctx.officeUserId, "casuals");
    const shifts = await officeUserMay(tx, ctx.officeUserId, "shifts");
    if (!casuals && !shifts) return null;
    const none = { rows: [], more: false };
    return {
      casuals: casuals ? (q ? await findCasuals(tx, q) : none) : null,
      sessions: shifts ? (q ? await findSessions(tx, q, now) : none) : null,
      sites: shifts ? (q ? await findSites(tx, q, now) : none) : null,
    };
  });
}

// The same, as the words and links the top bar shows (search-copy.ts), in the firm's time zone.
export async function officeSearchHits(
  ctx: OfficeContext,
  raw: string,
  timeZone: string,
): Promise<SearchHits | null> {
  const f = await officeSearch(ctx, raw);
  return f ? searchHits(f, timeZone) : null;
}
