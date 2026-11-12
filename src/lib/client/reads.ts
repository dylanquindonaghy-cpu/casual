import { sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import type { ClientRequestKind, ClientRequestStatus } from "../db/schema/client";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";
import { bookedJoin } from "../office/events";
import { isoDate, timesOn } from "../roster/shift-times";
import { payloadOf, type ClientPayload } from "./payloads";
import { urgentWhy, type UrgentWhy } from "./urgency";

// What a client contact sees (Phase 36.3; Dylan's approval, 2026-11-11: "clients see numbers only,
// never casuals' names"). Every read takes the contact's contract from their row inside the firm's
// transaction (a contact switched off reads nothing), and every query is over sessions, events,
// venues and counts only: no query here selects from workers, reads an assignment's worker_id, or
// returns any column that holds a person (tests/integration/client.reads.test.ts checks the
// answers hold no casual's id or name). A session is the contract's when its venue (its own site,
// else its event's) is one of the contract's sites.

export interface ClientContext {
  firm: { id: string };
  clientContactId: string;
  run?: WithFirm; // tests pass a withFirm on their own pool
  clock?: Clock;
}

export const clientParts = (ctx: ClientContext) => ({
  run: ctx.run ?? withFirm,
  now: (ctx.clock ?? systemClock).now(),
});

export interface ClientScope {
  contactId: string;
  contractId: string;
}

// The contact, switched on, and their contract; null otherwise. Held (FOR SHARE) so a switch-off
// waits for a request being sent.
export async function clientScope(
  tx: FirmTx,
  clientContactId: string,
): Promise<ClientScope | null> {
  if (!z.uuid().safeParse(clientContactId).success) return null;
  const { rows } = await tx.execute<{ contract_id: string }>(sql`
    select contract_id::text as contract_id from client_contacts
     where id = ${clientContactId}::uuid and is_on
     for share
  `);
  const r = rows[0];
  return r ? { contactId: clientContactId, contractId: r.contract_id } : null;
}

// "The session `s` (with its event `e`) is at one of the contract's venues."
export const contractSessionSql = (contractId: string) => sql`exists (
  select 1 from sites v
   where v.firm_id = s.firm_id and v.id = coalesce(s.site_id, e.site_id)
     and v.client_id = ${contractId}::uuid)`;

export interface ClientSessionRow {
  shiftId: string;
  role: string;
  post: string | null; // the location within the venue ("North Gate")
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  places: number;
  booked: number;
  toFill: number;
  // Offers are going out for it now (urgent, with a place free): what the client's chip says.
  offering: boolean;
  cancelled: boolean;
}

export interface ClientEvent {
  eventId: string;
  name: string;
  site: string | null;
  address: string | null; // the event's venue on one line
  startsAt: Date; // its first session's start
  places: number;
  booked: number;
  toFill: number;
  sessions: ClientSessionRow[];
}

export const CLIENT_EVENTS_MAX = 50;
export const CLIENT_SESSIONS_PER_EVENT = 200;

type SessionSql = {
  shift_id: string;
  event_id: string;
  event_name: string;
  event_site: string | null;
  address: string | null;
  role: string;
  post: string | null;
  site: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  headcount: number;
  booked: number;
  status: string;
  is_urgent: boolean;
};

async function contractSessions(
  tx: FirmTx,
  contractId: string,
  now: Date,
  only: { eventId?: string } = {},
): Promise<SessionSql[]> {
  const { rows } = await tx.execute<SessionSql>(sql`
    select s.id::text as shift_id, e.id::text as event_id, e.name as event_name,
           ev.name as event_site,
           nullif(concat_ws(', ', ev.address_line1, ev.address_line2, ev.town, ev.postcode), '')
             as address,
           s.role, s.post, coalesce(sv.name, ev.name) as site, s.starts_at, s.ends_at,
           s.headcount, b.booked, s.status, s.is_urgent
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
      left join sites sv on sv.firm_id = s.firm_id and sv.id = s.site_id
      left join sites ev on ev.firm_id = e.firm_id and ev.id = e.site_id
     where s.ends_at > ${now} and s.status <> 'draft'
       and ${contractSessionSql(contractId)}
       ${only.eventId ? sql`and e.id = ${only.eventId}::uuid` : sql``}
     order by s.starts_at, s.post nulls last, s.role, s.id
     limit ${CLIENT_EVENTS_MAX * CLIENT_SESSIONS_PER_EVENT}
  `);
  return rows;
}

const sessionOf = (r: SessionSql, now: Date): ClientSessionRow => {
  const cancelled = r.status === "cancelled";
  const places = cancelled ? 0 : r.headcount;
  const booked = cancelled ? 0 : Math.min(r.booked, r.headcount);
  const toFill = Math.max(0, places - booked);
  return {
    shiftId: r.shift_id,
    role: r.role,
    post: r.post,
    site: r.site,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    places,
    booked,
    toFill,
    offering:
      !cancelled && r.is_urgent && toFill > 0 && new Date(r.starts_at).getTime() > now.getTime(),
    cancelled,
  };
};

function eventsOf(rows: SessionSql[], now: Date): ClientEvent[] {
  const byEvent = new Map<string, ClientEvent>();
  for (const r of rows) {
    let ev = byEvent.get(r.event_id);
    if (!ev) {
      if (byEvent.size >= CLIENT_EVENTS_MAX) continue;
      ev = {
        eventId: r.event_id,
        name: r.event_name,
        site: r.event_site,
        address: r.address,
        startsAt: new Date(r.starts_at),
        places: 0,
        booked: 0,
        toFill: 0,
        sessions: [],
      };
      byEvent.set(r.event_id, ev);
    }
    if (ev.sessions.length >= CLIENT_SESSIONS_PER_EVENT) continue;
    const s = sessionOf(r, now);
    ev.sessions.push(s);
    ev.places += s.places;
    ev.booked += s.booked;
    ev.toFill += s.toFill;
  }
  return [...byEvent.values()];
}

// Their contract's events to come (a session not yet ended), soonest first, each with its sessions'
// places, booked and to fill. Null: not a live client login.
export async function clientEvents(ctx: ClientContext): Promise<ClientEvent[] | null> {
  const { run, now } = clientParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return null;
    return eventsOf(await contractSessions(tx, scope.contractId, now), now);
  });
}

// One event of theirs (null: not theirs, not to come, or not a live login; the same answer, so
// another contract's or firm's event can't be told apart from none).
export async function clientEvent(
  ctx: ClientContext,
  eventId: string,
): Promise<ClientEvent | null> {
  if (!z.uuid().safeParse(eventId).success) return null;
  const { run, now } = clientParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return null;
    return eventsOf(await contractSessions(tx, scope.contractId, now, { eventId }), now)[0] ?? null;
  });
}

export interface ClientFormChoices {
  venues: { siteId: string; name: string }[]; // the contract's venues (a new event's)
  roles: string[]; // the firm's roles (a new event's sessions)
  timeZone: string;
}

// What the request form offers: the contract's venues and the firm's roles.
export async function clientFormChoices(ctx: ClientContext): Promise<ClientFormChoices | null> {
  const { run } = clientParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return null;
    const { rows: venues } = await tx.execute<{ site_id: string; name: string }>(sql`
      select id::text as site_id, name from sites
       where client_id = ${scope.contractId}::uuid order by lower(name), id
    `);
    const { rows: roles } = await tx.execute<{ role: string }>(sql`
      select role from credential_rules
      union
      select distinct s.role from shifts s
        join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
       where ${contractSessionSql(scope.contractId)}
      order by role
    `);
    return {
      venues: venues.map((v) => ({ siteId: v.site_id, name: v.name })),
      roles: roles.map((r) => r.role),
      timeZone: await firmTimeZone(tx),
    };
  });
}

export interface ClientRequestView {
  id: string;
  kind: ClientRequestKind;
  status: ClientRequestStatus;
  payload: ClientPayload[ClientRequestKind] | null;
  note: string | null;
  officeAnswer: string | null; // the reason for a decline, or the office's question
  answeredAt: Date | null;
  createdAt: Date;
  byYou: boolean; // sent by this contact (the others: a colleague on the same contract)
  urgent: UrgentWhy | null; // worked out now
  session: { shiftId: string; role: string; site: string | null; startsAt: Date } | null;
  eventId: string | null;
}

export const CLIENT_REQUESTS_SHOWN = 100;

// Their contract's requests, newest first, with the status and the office's answer.
export async function clientRequestList(ctx: ClientContext): Promise<ClientRequestView[] | null> {
  const { run, now } = clientParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const scope = await clientScope(tx, ctx.clientContactId);
    if (!scope) return null;
    const timeZone = await firmTimeZone(tx);
    const { rows } = await tx.execute<{
      id: string;
      kind: ClientRequestKind;
      status: ClientRequestStatus;
      payload: unknown;
      client_note: string | null;
      office_answer: string | null;
      answered_at: string | Date | null;
      created_at: string | Date;
      contact_id: string;
      shift_id: string | null;
      event_id: string | null;
      role: string | null;
      site: string | null;
      starts_at: string | Date | null;
      headcount: number | null;
      booked: number | null;
    }>(sql`
      select r.id::text as id, r.kind, r.status, r.payload, r.client_note, r.office_answer,
             r.answered_at, r.created_at, r.client_contact_id::text as contact_id,
             r.shift_id::text as shift_id, r.event_id::text as event_id,
             s.role, coalesce(sv.name, ev.name) as site, s.starts_at, s.headcount, b.booked
        from client_requests r
        left join shifts s on s.firm_id = r.firm_id and s.id = r.shift_id
        left join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        left join lateral (
          select count(*)::int as booked from assignments a
           where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id is not null
             and a.status not in ('cancelled_worker', 'cancelled_firm') and a.slot <= s.headcount
        ) b on true
        left join sites sv on sv.firm_id = s.firm_id and sv.id = s.site_id
        left join sites ev on ev.firm_id = e.firm_id and ev.id = e.site_id
       where r.contract_id = ${scope.contractId}::uuid
       order by r.created_at desc, r.id
       limit ${CLIENT_REQUESTS_SHOWN}
    `);
    return rows.map((r) => {
      const payload = payloadOf(r.kind, r.payload);
      const startsAt = r.starts_at
        ? new Date(r.starts_at)
        : firstStartOf(r.kind, payload, timeZone);
      const booked = r.booked ?? 0;
      const open = r.status === "waiting" || r.status === "asked";
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        payload,
        note: r.client_note,
        officeAnswer: r.office_answer,
        answeredAt: r.answered_at ? new Date(r.answered_at) : null,
        createdAt: new Date(r.created_at),
        byYou: r.contact_id === scope.contactId,
        urgent: open
          ? urgentWhy({
              kind: r.kind,
              now,
              startsAt,
              booked,
              free: Math.max(0, (r.headcount ?? 0) - booked),
              places: placesOf(payload),
            })
          : null,
        session:
          r.shift_id && r.role && r.starts_at
            ? {
                shiftId: r.shift_id,
                role: r.role,
                site: r.site,
                startsAt: new Date(r.starts_at),
              }
            : null,
        eventId: r.event_id,
      };
    });
  });
}

// A new event's first session's start, in the firm's time zone (null: not a new event, or a date
// or time that doesn't make a session).
export function firstStartOf(
  kind: ClientRequestKind,
  payload: ClientPayload[ClientRequestKind] | null,
  timeZone: string,
): Date | null {
  if (kind !== "new_event" || !payload) return null;
  const e = payload as ClientPayload["new_event"];
  const date = isoDate(e.date);
  if (!date) return null;
  const starts = e.sessions
    .map((x) => timesOn(date, x.start, x.end, timeZone)?.startsAt)
    .filter((d): d is Date => d !== undefined)
    .sort((a, b) => a.getTime() - b.getTime());
  return starts[0] ?? null;
}

export async function firmTimeZone(tx: FirmTx): Promise<string> {
  const { rows } = await tx.execute<{ timezone: string }>(
    sql`select timezone from firms where id = app_current_firm_id()`,
  );
  return rows[0]?.timezone ?? "Europe/London";
}

export const placesOf = (payload: ClientPayload[ClientRequestKind] | null): number | undefined => {
  const p = payload as Record<string, unknown> | null;
  return typeof p?.places === "number" ? p.places : undefined;
};
