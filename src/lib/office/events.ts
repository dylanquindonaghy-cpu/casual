import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  credentialRules,
  credentialTypes,
  firms,
  rosterSources,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Events & sessions (docs/office-v2.md 3.3; docs/screens.md `/office/events`): every event with a
// session to come, as a card, and one event's page with all its sessions and who is booked. Reads
// only, inside the firm (RLS scopes every row), for admins and resourcers (checked here as well as
// on the page). A session's pay rate is shown; no pay record is ever read here.

export const EVENT_VIEWS = ["all", "showing", "hidden", "urgent"] as const;
export type EventView = (typeof EVENT_VIEWS)[number];
export const EVENT_LIST_MAX = 50;
// Sessions on one card in the list; the event's page shows them all.
export const CARD_SESSIONS_MAX = 30;

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface SessionRow {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: "draft" | "open" | "filled" | "cancelled";
  headcount: number;
  booked: number;
  isUrgent: boolean;
  urgentGap: boolean; // urgent, open, not started, with a place free
  showing: boolean; // the session's own switch
  payRatePence: number | null;
  post: string | null;
  meetingPoint: string | null;
  uniform: string | null;
  // The role's qualifications, then the session's extra ones (each once).
  requirements: { code: string; name: string }[];
  fromSheet: boolean;
  started: boolean;
  ended: boolean;
}

export interface EventCardData {
  eventId: string;
  name: string;
  place: string | null; // the event's site, else its sessions' one site
  firstStartsAt: Date;
  lastStartsAt: Date;
  showing: boolean; // the event's switch
  sessions: SessionRow[];
  moreSessions: number; // beyond CARD_SESSIONS_MAX (the list only)
  // Over every session loaded (shown or beyond the card's limit), not cancelled:
  sessionCount: number;
  placesFree: number; // in open sessions that haven't started
  full: boolean; // every one booked to its places (or marked filled)
  urgentGap: boolean; // a session with an urgent gap
}

export interface BookedCasual {
  workerId: string;
  name: string;
  status: "confirmed" | "completed" | "no_show";
}

export interface EventPage {
  timeZone: string;
  event: EventCardData;
  booked: Record<string, BookedCasual[]>; // by session (shift id)
}

export interface EventList {
  timeZone: string;
  view: EventView;
  // The firm's shifts come from a Google Sheet: no "Add shifts" or "Import shifts" here.
  hasPlanner: boolean;
  events: EventCardData[];
  more: boolean;
}

async function asOffice<T>(
  ctx: AuthContext,
  token: string,
  work: (tx: FirmTx, now: Date) => Promise<T>,
): Promise<T | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "shifts")) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => work(tx, now));
}

async function timeZoneOf(tx: FirmTx): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

// A session's urgent gap, as SQL over `s` with its booked count `b` (the dashboard's count too).
export const urgentGap = (now: Date) =>
  sql`(s.is_urgent and s.status = 'open' and s.starts_at > ${now} and b.booked < s.headcount)`;

// Places taken per session (bookings not cancelled, in the headcount's slots).
export const bookedJoin = sql`cross join lateral (
  select count(*)::int as booked from assignments a
   where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id is not null
     and a.status not in (${CANCELLED}) and a.slot <= s.headcount) b`;

type SessionSqlRow = {
  id: string;
  event_id: string;
  role: string;
  starts_at: string | Date;
  ends_at: string | Date;
  status: SessionRow["status"];
  headcount: number;
  booked: number;
  is_urgent: boolean;
  urgent_gap: boolean;
  showing_to_casuals: boolean;
  pay_rate_pence: number | null;
  post: string | null;
  meeting_point: string | null;
  uniform: string | null;
  required_credentials: string[];
  source: string;
  site_name: string | null;
};

// The sessions of these events (`upcoming`: not ended and not cancelled), soonest first, with the
// qualification names.
async function sessionsOf(
  tx: FirmTx,
  eventIds: string[],
  now: Date,
  upcoming: boolean,
): Promise<{
  rows: SessionSqlRow[];
  requirementsOf: (r: SessionSqlRow) => SessionRow["requirements"];
}> {
  if (eventIds.length === 0) return { rows: [], requirementsOf: () => [] };
  const { rows } = await tx.execute<SessionSqlRow>(sql`
    select s.id, s.event_id, s.role, s.starts_at, s.ends_at, s.status, s.headcount, b.booked,
           s.is_urgent, ${urgentGap(now)} as urgent_gap, s.showing_to_casuals, s.pay_rate_pence,
           s.post, s.meeting_point, s.uniform, s.required_credentials, s.source,
           si.name as site_name
      from shifts s
      ${bookedJoin}
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where s.event_id in (${sql.join(
       eventIds.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       ${upcoming ? sql`and s.ends_at > ${now} and s.status <> 'cancelled'` : sql``}
     order by s.starts_at, s.role, s.id
  `);
  const roles = [...new Set(rows.map((r) => r.role))];
  const rules = roles.length
    ? await tx
        .select({ role: credentialRules.role, types: credentialRules.requiredTypes })
        .from(credentialRules)
        .where(inArray(credentialRules.role, roles))
    : [];
  const byRole = new Map<string, string[]>();
  for (const r of rules) byRole.set(r.role, [...(byRole.get(r.role) ?? []), ...r.types]);
  const names = new Map(
    (
      await tx
        .select({ code: credentialTypes.code, name: credentialTypes.name })
        .from(credentialTypes)
    ).map((t) => [t.code, t.name]),
  );
  return {
    rows,
    requirementsOf: (r) =>
      [...new Set([...(byRole.get(r.role) ?? []), ...r.required_credentials])].map((code) => ({
        code,
        name: names.get(code) ?? code,
      })),
  };
}

function sessionOf(
  r: SessionSqlRow,
  requirements: SessionRow["requirements"],
  now: Date,
): SessionRow {
  const startsAt = new Date(r.starts_at);
  const endsAt = new Date(r.ends_at);
  return {
    shiftId: r.id,
    role: r.role,
    startsAt,
    endsAt,
    status: r.status,
    headcount: r.headcount,
    booked: r.booked,
    isUrgent: r.is_urgent,
    urgentGap: r.urgent_gap,
    showing: r.showing_to_casuals,
    payRatePence: r.pay_rate_pence,
    post: r.post,
    meetingPoint: r.meeting_point,
    uniform: r.uniform,
    requirements,
    fromSheet: r.source === "sheets",
    started: startsAt.getTime() <= now.getTime(),
    ended: endsAt.getTime() <= now.getTime(),
  };
}

type EventSqlRow = {
  id: string;
  name: string;
  showing_to_casuals: boolean;
  site_name: string | null;
};

function cardOf(
  e: EventSqlRow,
  rows: SessionSqlRow[],
  requirementsOf: (r: SessionSqlRow) => SessionRow["requirements"],
  now: Date,
  max: number,
): EventCardData {
  const sessions = rows.map((r) => sessionOf(r, requirementsOf(r), now));
  const live = sessions.filter((x) => x.status !== "cancelled");
  const sites = [...new Set(rows.map((r) => r.site_name).filter((n): n is string => n !== null))];
  const first = sessions[0]?.startsAt ?? now;
  return {
    eventId: e.id,
    name: e.name,
    place: e.site_name ?? (sites.length === 1 ? (sites[0] ?? null) : null),
    firstStartsAt: first,
    lastStartsAt: sessions.at(-1)?.startsAt ?? first,
    showing: e.showing_to_casuals,
    sessions: sessions.slice(0, max),
    moreSessions: Math.max(0, sessions.length - max),
    sessionCount: live.length,
    placesFree: live
      .filter((x) => x.status === "open" && !x.started)
      .reduce((n, x) => n + Math.max(0, x.headcount - x.booked), 0),
    full: live.length > 0 && live.every((x) => x.status === "filled" || x.booked >= x.headcount),
    urgentGap: live.some((x) => x.urgentGap),
  };
}

async function hasPlanner(tx: FirmTx): Promise<boolean> {
  const [source] = await tx
    .select({ id: rosterSources.id })
    .from(rosterSources)
    .where(and(eq(rosterSources.kind, "sheets"), eq(rosterSources.enabled, true)))
    .limit(1);
  return source !== undefined;
}

// Events with a session to come (not ended, not cancelled), soonest first, at most EVENT_LIST_MAX
// (`more`: there were others). `view`: those showing to casuals, those hidden, or those with an
// urgent gap. Each card holds at most `sessionsMax` of its sessions (the dashboard's are shorter).
export async function loadEventCards(
  tx: FirmTx,
  now: Date,
  view: EventView,
  sessionsMax = CARD_SESSIONS_MAX,
): Promise<{ events: EventCardData[]; more: boolean }> {
  const having: Record<EventView, SQL> = {
    all: sql`true`,
    showing: sql`e.showing_to_casuals`,
    hidden: sql`not e.showing_to_casuals`,
    urgent: sql`bool_or(${urgentGap(now)})`,
  };
  const { rows: events } = await tx.execute<EventSqlRow & { first_start: string | Date }>(sql`
    select e.id, e.name, e.showing_to_casuals, esi.name as site_name,
           min(s.starts_at) as first_start
      from shift_events e
      join shifts s on s.firm_id = e.firm_id and s.event_id = e.id
      ${bookedJoin}
      left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
     where s.ends_at > ${now} and s.status <> 'cancelled'
     group by e.id, e.name, e.showing_to_casuals, esi.name
    having ${having[view]}
     order by min(s.starts_at), e.id
     limit ${EVENT_LIST_MAX + 1}
  `);
  const kept = events.slice(0, EVENT_LIST_MAX);
  const { rows, requirementsOf } = await sessionsOf(
    tx,
    kept.map((e) => e.id),
    now,
    true,
  );
  return {
    more: events.length > EVENT_LIST_MAX,
    events: kept.map((e) =>
      cardOf(
        e,
        rows.filter((r) => r.event_id === e.id),
        requirementsOf,
        now,
        sessionsMax,
      ),
    ),
  };
}

export async function officeEventList(
  ctx: AuthContext,
  token: string,
  view: EventView,
): Promise<EventList | null> {
  return asOffice(ctx, token, async (tx, now) => {
    const { events, more } = await loadEventCards(tx, now, view);
    return {
      timeZone: await timeZoneOf(tx),
      view,
      hasPlanner: await hasPlanner(tx),
      more,
      events,
    };
  });
}

// One event: every session (past and cancelled too), and who is booked on each.
export async function officeEventPage(
  ctx: AuthContext,
  token: string,
  eventId: string,
): Promise<EventPage | null> {
  if (!z.uuid().safeParse(eventId).success) return null;
  return asOffice(ctx, token, async (tx, now) => {
    const { rows: found } = await tx.execute<EventSqlRow>(sql`
      select e.id, e.name, e.showing_to_casuals, esi.name as site_name
        from shift_events e
        left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
       where e.id = ${eventId}
    `);
    const e = found[0];
    if (!e) return null;
    const { rows, requirementsOf } = await sessionsOf(tx, [e.id], now, false);
    const ids = rows.map((r) => r.id);
    const people = ids.length
      ? await tx.execute<{
          shift_id: string;
          worker_id: string;
          first_name: string | null;
          last_name: string | null;
          status: BookedCasual["status"];
        }>(sql`
          select a.shift_id, a.worker_id, w.first_name, w.last_name, a.status
            from assignments a
            join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
           where a.shift_id in (${sql.join(
             ids.map((id) => sql`${id}::uuid`),
             sql`, `,
           )})
             and a.status in ('confirmed', 'completed', 'no_show')
           order by w.last_name, w.first_name, a.id
        `)
      : { rows: [] };
    const booked: Record<string, BookedCasual[]> = {};
    for (const p of people.rows) {
      (booked[p.shift_id] ??= []).push({
        workerId: p.worker_id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        status: p.status,
      });
    }
    return {
      timeZone: await timeZoneOf(tx),
      event: cardOf(e, rows, requirementsOf, now, Number.MAX_SAFE_INTEGER),
      booked,
    };
  });
}
