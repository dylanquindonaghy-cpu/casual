import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import type { ClientRequestKind, ClientRequestStatus } from "../db/schema/client";
import type { FirmTx } from "../db/scoped";
import { uuidArray } from "../db/arrays";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { changeNoticeHours, noticeHours } from "../roster/notice";
import { isoDate, timesOn } from "../roster/shift-times";
import { isVisibleToCasuals } from "../roster/visibility";
import { payloadOf, type ClientPayload } from "./payloads";
import { placesChange, type PlacesChange } from "./preview-math";
import { firmTimeZone, placesOf, requestUrgency } from "./reads";
import type { UrgentWhy } from "./urgency";
import { OFFICE_TABS, requestTitle, type OfficeTab } from "./words";

// The office's side of client requests (Phase 36.4; the mock-up's "Client requests"): the queue
// (waiting, accepted, declined, and "To do in <planner>"), urgent first, narrowed to the contracts a
// person looks after as the dashboard is (none chosen: every contract); and "What accepting does",
// worked out by code from the session as it is now (src/lib/client/preview-math.ts): places before
// and after, the booked casuals a cut or a move reaches and their notice, whether offers go out, and
// whether the session is the firm's planner's, sheet's or connector's (then it goes on the
// planner's to-do list instead). Admins and resourcers only (client_requests), checked inside the
// firm's transaction. The office sees its casuals' names here (it's the office); a client never
// does (src/lib/client/reads.ts).

// A session's owner when it isn't ShiftDesk's own: the firm's Google Sheet, or its planner (the
// API or a connector), each of which sets the session's times and places itself.
export type SessionOwner = "sheet" | "planner";
export const ownerOf = (source: string): SessionOwner | null =>
  source === "sheets" ? "sheet" : source === "api" ? "planner" : null;

export interface RequestSessionFacts {
  shiftId: string;
  eventId: string;
  eventName: string;
  role: string;
  post: string | null;
  site: string | null;
  siteId: string | null;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number;
  status: string;
  source: string;
  isUrgent: boolean;
}

export interface OfficeClientRequest {
  id: string;
  kind: ClientRequestKind;
  status: ClientRequestStatus;
  contractId: string;
  contractName: string;
  contactId: string;
  contactName: string; // the client's own person (never a casual)
  title: string; // what was asked for, in words
  payload: ClientPayload[ClientRequestKind] | null;
  note: string | null; // the client's
  officeAnswer: string | null;
  answeredAt: Date | null;
  answeredBy: string | null; // the office user's id
  plannerDoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  urgent: UrgentWhy | null; // worked out now (waiting and asked ones; null once answered)
  session: RequestSessionFacts | null;
  eventId: string | null;
}

type RequestSql = {
  id: string;
  kind: ClientRequestKind;
  status: ClientRequestStatus;
  contract_id: string;
  contract_name: string;
  contact_id: string;
  contact_name: string;
  payload: unknown;
  client_note: string | null;
  office_answer: string | null;
  answered_at: string | Date | null;
  answered_by: string | null;
  planner_done_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  event_id: string | null;
  shift_id: string | null;
  s_event_id: string | null;
  event_name: string | null;
  role: string | null;
  post: string | null;
  site: string | null;
  site_id: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  headcount: number | null;
  booked: number | null;
  s_status: string | null;
  source: string | null;
  is_urgent: boolean | null;
};

const requestSelect = (where: SQL, order: SQL, limit: number) => sql`
  select r.id::text as id, r.kind, r.status, r.contract_id::text as contract_id,
         k.name as contract_name, c.id::text as contact_id, c.name as contact_name, r.payload,
         r.client_note, r.office_answer, r.answered_at, r.answered_by::text as answered_by,
         r.planner_done_at, r.created_at, r.updated_at, r.event_id::text as event_id,
         s.id::text as shift_id, s.event_id::text as s_event_id, e.name as event_name, s.role,
         s.post, coalesce(sv.name, ev.name) as site,
         coalesce(s.site_id, e.site_id)::text as site_id, s.starts_at, s.ends_at, s.headcount,
         b.booked, s.status as s_status, s.source, s.is_urgent
    from client_requests r
    join clients k on k.firm_id = r.firm_id and k.id = r.contract_id
    join client_contacts c on c.firm_id = r.firm_id and c.id = r.client_contact_id
    left join shifts s on s.firm_id = r.firm_id and s.id = r.shift_id
    left join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
    left join lateral (
      select count(*)::int as booked from assignments a
       where a.firm_id = s.firm_id and a.shift_id = s.id and a.worker_id is not null
         and a.status not in ('cancelled_worker', 'cancelled_firm') and a.slot <= s.headcount
    ) b on true
    left join sites sv on sv.firm_id = s.firm_id and sv.id = s.site_id
    left join sites ev on ev.firm_id = e.firm_id and ev.id = e.site_id
   where ${where}
   order by ${order}
   limit ${limit}`;

const date = (v: string | Date) => new Date(v);

export function requestOf(r: RequestSql, now: Date, timeZone: string): OfficeClientRequest {
  const payload = payloadOf(r.kind, r.payload);
  const session: RequestSessionFacts | null =
    r.shift_id && r.s_event_id && r.role && r.starts_at && r.ends_at
      ? {
          shiftId: r.shift_id,
          eventId: r.s_event_id,
          eventName: r.event_name ?? "",
          role: r.role,
          post: r.post,
          site: r.site,
          siteId: r.site_id,
          startsAt: date(r.starts_at),
          endsAt: date(r.ends_at),
          headcount: r.headcount ?? 0,
          booked: r.booked ?? 0,
          status: r.s_status ?? "open",
          source: r.source ?? "native",
          isUrgent: r.is_urgent ?? false,
        }
      : null;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    contractId: r.contract_id,
    contractName: r.contract_name,
    contactId: r.contact_id,
    contactName: r.contact_name,
    title: requestTitle(
      {
        kind: r.kind,
        payload,
        session: session
          ? { role: session.role, startsAt: session.startsAt, site: session.post ?? session.site }
          : null,
      },
      timeZone,
    ),
    payload,
    note: r.client_note,
    officeAnswer: r.office_answer,
    answeredAt: r.answered_at ? date(r.answered_at) : null,
    answeredBy: r.answered_by,
    plannerDoneAt: r.planner_done_at ? date(r.planner_done_at) : null,
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
    urgent: requestUrgency({ kind: r.kind, status: r.status, payload, now, timeZone, session }),
    session,
    eventId: r.event_id ?? session?.eventId ?? null,
  };
}

// The contracts a person looks after (null: none chosen, so every contract).
export async function myContracts(tx: FirmTx, officeUserId: string): Promise<string[] | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select client_id::text as id from office_user_clients
     where office_user_id = ${officeUserId}::uuid order by client_id
  `);
  return rows.length === 0 ? null : rows.map((r) => r.id);
}

const contractsSql = (contracts: string[] | null): SQL =>
  contracts === null ? sql`true` : sql`r.contract_id = any(${uuidArray(contracts)})`;

const TAB_SQL: Record<OfficeTab, SQL> = {
  waiting: sql`r.status in ('waiting', 'asked')`,
  accepted: sql`(r.status = 'accepted'
                 or (r.status = 'done_in_planner' and r.planner_done_at is not null))`,
  declined: sql`r.status = 'declined'`,
  planner: sql`r.status = 'done_in_planner' and r.planner_done_at is null`,
};

export const QUEUE_SHOWN = 100;

export interface ClientRequestQueue {
  tab: OfficeTab;
  mine: boolean; // narrowed to the person's contracts
  counts: Record<OfficeTab, number>;
  urgent: number; // waiting ones the rules find urgent now
  requests: OfficeClientRequest[]; // waiting: urgent first, then newest; the rest newest first
  plannerName: string | null; // for "To do in <planner>"
  timeZone: string;
}

export const queueOptions = z.strictObject({
  tab: z.enum(OFFICE_TABS).default("waiting"),
  // "mine": the contracts they look after (every contract when they look after none); "all".
  scope: z.enum(["mine", "all"]).default("mine"),
  contractId: z.uuid().optional(), // one contract only
});

// The firm's planner's name for the to-do list: its newest live API key's label (an admin names
// it, "AXLR8"), or null ("your planner").
export async function plannerName(tx: FirmTx): Promise<string | null> {
  const { rows } = await tx.execute<{ label: string }>(sql`
    select label from api_keys where revoked_at is null order by created_at desc, id limit 1
  `);
  return rows[0]?.label ?? null;
}

export async function loadClientRequestQueue(
  tx: FirmTx,
  now: Date,
  officeUserId: string,
  raw: z.input<typeof queueOptions> = {},
): Promise<ClientRequestQueue> {
  const opts = queueOptions.parse(raw);
  const timeZone = await firmTimeZone(tx);
  const contracts =
    opts.contractId !== undefined
      ? [opts.contractId]
      : opts.scope === "mine"
        ? await myContracts(tx, officeUserId)
        : null;
  const scope = contractsSql(contracts);
  const { rows: countRows } = await tx.execute<Record<OfficeTab, number>>(sql`
    select count(*) filter (where ${TAB_SQL.waiting})::int as waiting,
           count(*) filter (where ${TAB_SQL.accepted})::int as accepted,
           count(*) filter (where ${TAB_SQL.declined})::int as declined,
           count(*) filter (where ${TAB_SQL.planner})::int as planner
      from client_requests r where ${scope}
  `);
  const { rows } = await tx.execute<RequestSql>(
    requestSelect(
      sql`${TAB_SQL[opts.tab]} and ${scope}`,
      opts.tab === "waiting" ? sql`r.created_at desc, r.id` : sql`r.updated_at desc, r.id`,
      QUEUE_SHOWN,
    ),
  );
  const requests = rows.map((r) => requestOf(r, now, timeZone));
  if (opts.tab === "waiting") {
    // Urgent first (the rules' answer now), then as read (newest first); asked ones after those
    // still waiting for the office (they wait for the client).
    const rank = (r: OfficeClientRequest) => (r.status === "asked" ? 2 : r.urgent ? 0 : 1);
    requests.sort((a, b) => rank(a) - rank(b));
  }
  return {
    tab: opts.tab,
    mine: contracts !== null,
    counts: countRows[0] ?? { waiting: 0, accepted: 0, declined: 0, planner: 0 },
    urgent: requests.filter((r) => r.status === "waiting" && r.urgent).length,
    requests,
    plannerName: await plannerName(tx),
    timeZone,
  };
}

// The page's data for an admin or resourcer, or null.
export async function officeClientRequests(
  ctx: OfficeContext,
  opts: z.input<typeof queueOptions> = {},
): Promise<ClientRequestQueue | null> {
  const parsed = queueOptions.safeParse(opts);
  if (!parsed.success) return null;
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "client_requests"))
      ? loadClientRequestQueue(tx, now, ctx.officeUserId, parsed.data)
      : null,
  );
}

// One request (any contract: the office sees them all), or null.
export async function loadClientRequest(
  tx: FirmTx,
  now: Date,
  requestId: string,
  opts: { lock?: boolean } = {},
): Promise<OfficeClientRequest | null> {
  if (!z.uuid().safeParse(requestId).success) return null;
  if (opts.lock) {
    // The request's row first (accept, decline, ask and the client's reply take turns on it).
    const { rows } = await tx.execute(
      sql`select 1 from client_requests where id = ${requestId}::uuid for update`,
    );
    if (rows.length === 0) return null;
  }
  const timeZone = await firmTimeZone(tx);
  const { rows } = await tx.execute<RequestSql>(
    requestSelect(sql`r.id = ${requestId}::uuid`, sql`r.id`, 1),
  );
  const r = rows[0];
  return r ? requestOf(r, now, timeZone) : null;
}

// --- What accepting does --------------------------------------------------------------------------

export interface BookedCasual {
  assignmentId: string;
  workerId: string;
  name: string; // for the office only
  noticeHours: number; // the notice this change gives them
}

// What stops a new event being made as it stands: a date or time that doesn't make a session, one
// that has started, the client's venue no longer the contract's, or an address (no venue chosen yet).
export type NewEventProblem = "bad_time" | "in_past" | "bad_venue" | "choose_venue";

export type AcceptPreview =
  // More or fewer places: the numbers, who a cut cancels (the latest booked first, unless the
  // office chooses), and whether the new places are offered now.
  | {
      kind: "places";
      change: PlacesChange;
      cancels: BookedCasual[];
      // more places: "now" (offer waves go out), "hidden" (the session or its event is hidden from
      // casuals: none until it's shown), "closed" (the office marked it filled: open it again
      // first); fewer places: "none".
      offers: "now" | "hidden" | "closed" | "none";
    }
  // New times: from and to, a shortening or a move, and each booked casual's notice (the rules
  // are checked for each when the office accepts: a move someone can't work is refused).
  | {
      kind: "times";
      from: { startsAt: Date; endsAt: Date };
      to: { startsAt: Date; endsAt: Date };
      curtailed: boolean;
      booked: BookedCasual[];
    }
  // Cancel: every booked casual is cancelled by the firm with notice, no offers.
  | { kind: "cancel"; booked: BookedCasual[] }
  // A new event: made here, hidden from casuals until the office shows it, at one of the contract's
  // venues: the client's, or (an address the firm has no venue for yet) one the office chooses from
  // `venues` ("choose_venue": accepting needs one). Each session's notes become its instructions.
  | {
      kind: "new_event";
      name: string;
      venue: { siteId: string; name: string } | { address: string };
      venues: { siteId: string; name: string }[]; // the contract's venues, to choose from
      sessions: {
        role: string;
        places: number;
        startsAt: Date;
        endsAt: Date;
        instructions: string | null; // the client's notes for the session
      }[];
      problems: NewEventProblem[];
    }
  // A planner's, sheet's or connector's session: not changed here; "To do in <planner>".
  | { kind: "planner"; owner: SessionOwner; plannerName: string | null }
  // Something else: nothing changes by itself.
  | { kind: "other" }
  // The session can't be changed any more (started or cancelled): decline it, or ask the client.
  | { kind: "gone"; why: "started" | "cancelled" | "missing" };

export interface ClientRequestPreview {
  request: OfficeClientRequest;
  accept: AcceptPreview;
  canAnswer: boolean; // waiting or asked
}

// The booked casuals on a session (confirmed, within its places), latest booked first.
export async function bookedOn(
  tx: FirmTx,
  shiftId: string,
  noticeFor: (startsAt: Date) => number,
  startsAt: Date,
): Promise<BookedCasual[]> {
  const { rows } = await tx.execute<{
    id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
  }>(sql`
    select a.id::text as id, a.worker_id::text as worker_id, w.first_name, w.last_name
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
     where a.shift_id = ${shiftId}::uuid and a.status = 'confirmed' and a.slot <= s.headcount
     order by a.confirmed_at desc nulls last, a.slot desc, a.id
  `);
  return rows.map((r) => ({
    assignmentId: r.id,
    workerId: r.worker_id,
    name: `${r.first_name} ${r.last_name}`.trim(),
    noticeHours: noticeFor(startsAt),
  }));
}

// A contract's venues (its sites), by name: where a new event of theirs can be made.
export async function contractVenues(
  tx: FirmTx,
  contractId: string,
): Promise<{ siteId: string; name: string }[]> {
  const { rows } = await tx.execute<{ site_id: string; name: string }>(sql`
    select id::text as site_id, name from sites
     where client_id = ${contractId}::uuid order by lower(name), id
  `);
  return rows.map((v) => ({ siteId: v.site_id, name: v.name }));
}

export async function previewAccept(
  tx: FirmTx,
  now: Date,
  r: OfficeClientRequest,
): Promise<AcceptPreview> {
  const timeZone = await firmTimeZone(tx);
  if (r.kind === "other") return { kind: "other" };
  if (r.kind === "new_event") {
    const p = r.payload as ClientPayload["new_event"] | null;
    if (!p) return { kind: "gone", why: "missing" };
    const problems: NewEventProblem[] = [];
    const venues = await contractVenues(tx, r.contractId);
    let venue: { siteId: string; name: string } | { address: string };
    if ("siteId" in p.venue) {
      const siteId = p.venue.siteId;
      const found = venues.find((v) => v.siteId === siteId);
      venue = { siteId, name: found?.name ?? "" };
      if (!found) problems.push("bad_venue");
    } else {
      venue = { address: p.venue.address };
      problems.push("choose_venue");
    }
    const day = isoDate(p.date);
    const sessions = p.sessions.flatMap((s) => {
      const times = day ? timesOn(day, s.start, s.end, timeZone) : null;
      if (!times) {
        problems.push("bad_time");
        return [];
      }
      if (times.startsAt.getTime() <= now.getTime()) problems.push("in_past");
      return [{ role: s.role, places: s.places, ...times, instructions: s.notes ?? null }];
    });
    return {
      kind: "new_event",
      name: p.name,
      venue,
      venues,
      sessions,
      problems: [...new Set(problems)],
    };
  }
  const s = r.session;
  if (!s) return { kind: "gone", why: "missing" };
  const owner = ownerOf(s.source);
  if (owner) return { kind: "planner", owner, plannerName: await plannerName(tx) };
  if (s.status === "cancelled") return { kind: "gone", why: "cancelled" };
  if (s.status === "draft" || s.startsAt.getTime() <= now.getTime()) {
    return { kind: "gone", why: "started" };
  }
  const notice = (at: Date) => noticeHours(at, now);
  switch (r.kind) {
    case "more_places":
    case "fewer_places": {
      const change = placesChange(r.kind, s, { places: placesOf(r.payload) });
      if (change === null || change === "last_place") return { kind: "cancel", booked: [] };
      const booked = await bookedOn(tx, s.shiftId, notice, s.startsAt);
      const closed = s.status === "filled" && s.booked < s.headcount;
      const offers =
        r.kind === "fewer_places"
          ? ("none" as const)
          : closed
            ? ("closed" as const)
            : (await isVisibleToCasuals(tx, s.shiftId))
              ? ("now" as const)
              : ("hidden" as const);
      return { kind: "places", change, cancels: booked.slice(0, change.cancels), offers };
    }
    case "new_times": {
      const t = r.payload as ClientPayload["new_times"] | null;
      const day = t ? isoDate(t.date) : null;
      const to = t && day ? timesOn(day, t.start, t.end, timeZone) : null;
      if (!to) return { kind: "gone", why: "missing" };
      const booked = await bookedOn(
        tx,
        s.shiftId,
        (at) => changeNoticeHours(at, to.startsAt, now),
        s.startsAt,
      );
      return {
        kind: "times",
        from: { startsAt: s.startsAt, endsAt: s.endsAt },
        to,
        curtailed:
          to.startsAt.getTime() >= s.startsAt.getTime() &&
          to.endsAt.getTime() <= s.endsAt.getTime(),
        booked,
      };
    }
    case "cancel_session":
      return { kind: "cancel", booked: await bookedOn(tx, s.shiftId, notice, s.startsAt) };
  }
}

// The request with what accepting it would do, for an admin or resourcer (null otherwise, or when
// there's no such request).
export async function officeClientRequestPreview(
  ctx: OfficeContext,
  requestId: string,
): Promise<ClientRequestPreview | null> {
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_requests"))) return null;
    const request = await loadClientRequest(tx, now, requestId);
    if (!request) return null;
    return {
      request,
      accept: await previewAccept(tx, now, request),
      canAnswer: request.status === "waiting" || request.status === "asked",
    };
  });
}

// --- Counts for the office's notifications (Updates, the bell, the top bar, the summary) ---------

export interface ClientRequestCounts {
  waiting: number; // waiting for the office (not those it asked the client about)
  urgent: number; // of those, urgent by the rules now
  plannerToDo: number; // accepted, still to do in the planner
}

// The open requests' facts, on these contracts' venues' terms: `sites` as Updates narrows (a
// person's contracts' venues; null: every contract). A request counts when its contract owns one of
// those venues.
export const requestSitesSql = (sites: string[] | null): SQL =>
  sites === null
    ? sql`true`
    : sql`r.contract_id in (select v.client_id from sites v
                             where v.id = any(${uuidArray(sites)}) and v.client_id is not null)`;

export const OPEN_REQUESTS_READ = 500;

export async function loadOpenClientRequests(
  tx: FirmTx,
  now: Date,
  sites: string[] | null,
  limit: number = QUEUE_SHOWN,
): Promise<OfficeClientRequest[]> {
  const timeZone = await firmTimeZone(tx);
  const { rows } = await tx.execute<RequestSql>(
    requestSelect(
      sql`(r.status in ('waiting', 'asked')
           or (r.status = 'done_in_planner' and r.planner_done_at is null))
          and ${requestSitesSql(sites)}`,
      sql`r.created_at desc, r.id`,
      limit,
    ),
  );
  return rows.map((r) => requestOf(r, now, timeZone));
}

// The counts: waiting and to do in the planner exactly (SQL); urgent by the rules (code), over the
// newest OPEN_REQUESTS_READ open ones (far more than any firm has waiting).
export async function countClientRequests(
  tx: FirmTx,
  now: Date,
  sites: string[] | null,
): Promise<ClientRequestCounts> {
  const { rows } = await tx.execute<{ waiting: number; planner: number }>(sql`
    select count(*) filter (where r.status = 'waiting')::int as waiting,
           count(*) filter (where r.status = 'done_in_planner'
                              and r.planner_done_at is null)::int as planner
      from client_requests r
     where ${requestSitesSql(sites)}
  `);
  const open = await loadOpenClientRequests(tx, now, sites, OPEN_REQUESTS_READ);
  return {
    waiting: rows[0]?.waiting ?? 0,
    urgent: open.filter((r) => r.status === "waiting" && r.urgent !== null).length,
    plannerToDo: rows[0]?.planner ?? 0,
  };
}

// The whole firm's (Needs attention and the top bar's chip are the firm's, as their other counts).
export const clientRequestCounts = (tx: FirmTx, now: Date) => countClientRequests(tx, now, null);
