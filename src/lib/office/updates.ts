import { eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import type { FirmTx } from "../db/scoped";
import { officeUsers } from "../db/schema";
import type { PayIssue } from "../portal/pay-query-kinds";
import { localDateOf } from "../time/zoned";
import type { ClientRequestKind } from "../db/schema/client";
import { loadOpenClientRequests, requestSitesSql } from "../client/queue";
import type { UrgentWhy } from "../client/urgency";
import { sitesSql } from "./contract-scope";
import { loadUpdates, type Update } from "./dashboard-map";
import { enquirySource, enquiryWindow, needsPerson } from "./enquiries";
import { requestWaiting } from "./enquiry-sql";
import { bookedJoin, placeFree } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { loadTellMe } from "./tell-me";
import type { TellMeKind } from "./tell-me-copy";
import {
  DEFAULT_VIEW,
  eventChoices,
  eventOf,
  inKind,
  kindsFor,
  LOW_COVER_DAYS,
  LOW_COVER_SHOWN,
  needsAction,
  orderLowCover,
  periodStart,
  UPDATE_KINDS,
  type LowCover,
  type UpdateKind,
  type UpdatesView,
} from "./updates-view";

// Updates (Phase 26.4; the spec page's "Updates and alerts", upd-1 to upd-3, and sys-8's bell):
// what happened on the person's contracts (every venue when they look after none) over the last
// week; since Phase 36.2 over the period chosen (today, 3, 7 or 30 days), for one event or all,
// one kind at a time (updates-view.ts), with pay queries (admins) and enquiries (the shifts line's
// messages for a person and the app's requests waiting) beside the sessions' news, and "Low on
// cover": the next week's events with places to fill, least covered first. "Needs action": a place still open close to its start, a casual's cancellation whose place
// is open again, and a photo or certificate to check, each with its button. "Everything": those and
// places casuals took (overnight ones marked), cancellations already covered, and offers with no
// reply. The bell counts what came in since the person last marked Updates seen ("Mark all as
// seen"); the pop-up shows a casual's cancellation the moment one lands. All counted by code from
// the firm's own records, inside its transaction.

export const UPDATES_PAGE_HOURS = 7 * 24;
export const UPDATES_PAGE_SHOWN = 100;
// A place still open this close to its start needs action: the product's "soon" line (a session's
// card goes red under 2 days, as cancellations under 48 hours' notice do).
export const OPEN_SOON_HOURS = 48;
export const POPUP_MINUTES = 30; // a cancellation newer than this pops up (once per browser)

export interface OpenSoon {
  kind: "open-soon";
  at: Date; // its start (they're listed soonest first)
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  placesFree: number;
  urgent: boolean;
  offers: number; // offers sent for it, any answer
  eventId?: string;
  event?: string;
}
// A session still not marked 2 days after it ended (Phase 26.7, aud-12): "Mark who worked"
// (reliability counts only marked sessions). Looked for back to MARK_LOOKBACK_DAYS.
export const MARK_AFTER_HOURS = 48;
export const MARK_LOOKBACK_DAYS = 28;
export interface ToMark {
  kind: "to-mark";
  at: Date; // when it ended
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  unmarked: number;
  eventId?: string;
  event?: string;
}
// A client's request (Phase 36.4): waiting for the office (needs action, urgent ones first), asked
// about (waiting for the client), or accepted but still to do in the firm's planner (needs action).
export interface ClientRequestUpdate {
  kind: "client-request";
  at: Date; // when it was sent, or the client last replied
  requestId: string;
  requestKind: ClientRequestKind;
  status: "waiting" | "asked" | "done_in_planner";
  contract: string; // the contract's name
  title: string; // what was asked for, in words (src/lib/client/words.ts requestTitle)
  urgent: UrgentWhy | null; // the rules' answer now
}
// A casual's pay query still with payroll (open, or in a digest not yet answered), from when she
// sent it (Phase 36.2): for those who may see pay queries (admins on Updates).
export interface PayQueryUpdate {
  kind: "pay-query";
  at: Date;
  id: string;
  worker: string;
  issue: PayIssue;
  workDate: string; // yyyy-mm-dd
  eventId?: string; // the session's event, when she named a session
  event?: string;
}
// A message to the shifts line or an email to the staffing inbox that needs a person (Enquiries'
// "Need a person", Phase 36.2).
export interface EnquiryUpdate {
  kind: "enquiry";
  at: Date;
  messageId: string;
  who: string; // the casual's name, or "Unknown number" and so on (enquiries-copy.ts whoName)
  channel: "whatsapp" | "sms" | "voice" | "email" | "app";
}
// A request made in the app still waiting for an answer (Enquiries' "Requests from the app").
export interface AppRequestUpdate {
  kind: "app-request";
  at: Date;
  requestId: string;
  worker: string;
  type: string;
  eventId?: string;
  event?: string;
}
export type PageUpdate =
  | Update
  | OpenSoon
  | ToMark
  | PayQueryUpdate
  | EnquiryUpdate
  | AppRequestUpdate
  | ClientRequestUpdate;

// What needs someone to act now (updates-view.ts, with the kinds).
export { needsAction };

// New since the person last marked Updates seen (what the bell counts): places taken, casuals'
// cancellations, and uploads when they asked for them ("Tell me about"). Places still open and
// offers with no reply are states, not news.
export const isNew = (u: PageUpdate, seenAt: Date | null, uploads: boolean): boolean =>
  (u.kind === "took" ||
    u.kind === "cancelled" ||
    (u.kind === "upload" && uploads) ||
    (u.kind === "client-request" && u.status === "waiting")) &&
  (seenAt === null || u.at.getTime() > seenAt.getTime());

export interface UpdatesPage {
  timeZone: string;
  now: Date;
  mine: boolean; // narrowed to the person's contracts
  seenAt: Date | null; // when they last marked it seen (null: never)
  tellMe: TellMeKind[]; // their "Tell me about" switches
  newCount: number; // as the bell counts it
  today: number; // updates since midnight, the firm's day (places still open aside)
  // The view (Phase 36.2): the period, the event (null: every event, or one not found in the firm)
  // and the kind, as the address asked.
  view: UpdatesView;
  kinds: UpdateKind[]; // the chips this person sees (kindsFor)
  counts: Record<UpdateKind, number>; // how many of each, in the period and the event
  events: { id: string; name: string }[]; // events with something in the period (and the chosen one)
  shown: PageUpdate[]; // the list: the period's, the event's, the kind's
  // The period's and the event's (every kind): what needs action, and everything.
  needsAction: PageUpdate[];
  everything: PageUpdate[];
  more: boolean; // more than UPDATES_PAGE_SHOWN of a kind in the period (the newest are shown)
  lowCover: LowCover[]; // the next week's events with places to fill, least covered first
}

// The person's contracts' venues (null: they look after none, so every venue).
export async function mySites(tx: FirmTx, officeUserId: string): Promise<string[] | null> {
  const { rows } = await tx.execute<{ id: string | null; any_contract: boolean }>(sql`
    select v.id::text as id, true as any_contract
      from office_user_clients oc
      left join sites v on v.firm_id = oc.firm_id and v.client_id = oc.client_id
     where oc.office_user_id = ${officeUserId}::uuid
  `);
  if (rows.length === 0) return null;
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))].sort();
}

// Sessions with a place free starting within OPEN_SOON_HOURS, soonest first.
async function loadOpenSoon(tx: FirmTx, now: Date, sites: string[] | null): Promise<OpenSoon[]> {
  const { rows } = await tx.execute<{
    shift_id: string;
    role: string;
    site: string | null;
    starts_at: string | Date;
    places_free: number;
    urgent: boolean;
    offers: number;
    event_id: string;
    event: string;
  }>(sql`
    select s.id::text as shift_id, s.role, coalesce(si.name, esi.name) as site, s.starts_at,
           (s.headcount - b.booked)::int as places_free, s.is_urgent as urgent,
           e.id::text as event_id, e.name as event,
           (select count(*)::int from offers o
             where o.firm_id = s.firm_id and o.shift_id = s.id) as offers
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
     where ${placeFree(now)}
       and s.starts_at <= ${new Date(now.getTime() + OPEN_SOON_HOURS * 3_600_000)}
       and ${sitesSql(sites)}
     order by s.starts_at, s.id
     limit ${UPDATES_PAGE_SHOWN}
  `);
  return rows.map((r) => ({
    kind: "open-soon",
    at: new Date(r.starts_at),
    shiftId: r.shift_id,
    role: r.role,
    site: r.site,
    startsAt: new Date(r.starts_at),
    placesFree: r.places_free,
    urgent: r.urgent,
    offers: r.offers,
    eventId: r.event_id,
    event: r.event,
  }));
}

// Sessions that ended more than MARK_AFTER_HOURS ago with bookings nobody marked, oldest first.
async function loadToMark(tx: FirmTx, now: Date, sites: string[] | null): Promise<ToMark[]> {
  const { rows } = await tx.execute<{
    shift_id: string;
    role: string;
    site: string | null;
    starts_at: string | Date;
    ends_at: string | Date;
    unmarked: number;
    event_id: string;
    event: string;
  }>(sql`
    select s.id::text as shift_id, s.role, coalesce(si.name, esi.name) as site, s.starts_at,
           s.ends_at, count(a.id)::int as unmarked, e.id::text as event_id, e.name as event
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      join assignments a on a.firm_id = s.firm_id and a.shift_id = s.id
                        and a.worker_id is not null and a.status = 'confirmed'
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
     where s.status <> 'cancelled'
       and s.ends_at <= ${new Date(now.getTime() - MARK_AFTER_HOURS * 3_600_000)}
       and s.ends_at > ${new Date(now.getTime() - MARK_LOOKBACK_DAYS * 24 * 3_600_000)}
       and ${sitesSql(sites)}
     group by s.id, s.role, si.name, esi.name, s.starts_at, s.ends_at, e.id, e.name
     order by s.ends_at, s.id
     limit ${UPDATES_PAGE_SHOWN}
  `);
  return rows.map((r) => ({
    kind: "to-mark",
    at: new Date(r.ends_at),
    shiftId: r.shift_id,
    role: r.role,
    site: r.site,
    startsAt: new Date(r.starts_at),
    unmarked: r.unmarked,
    eventId: r.event_id,
    event: r.event,
  }));
}

// Client requests still open on the person's contracts (Phase 36.4): waiting ones (urgent first),
// asked ones and the planner's to-dos, as Updates items.
async function loadClientRequestUpdates(
  tx: FirmTx,
  now: Date,
  sites: string[] | null,
): Promise<ClientRequestUpdate[]> {
  const open = await loadOpenClientRequests(tx, now, sites, UPDATES_PAGE_SHOWN);
  const items = open.map((r): ClientRequestUpdate => ({
    kind: "client-request",
    at: r.status === "waiting" && r.updatedAt > r.createdAt ? r.updatedAt : r.createdAt,
    requestId: r.id,
    requestKind: r.kind,
    status: r.status === "asked" || r.status === "done_in_planner" ? r.status : "waiting",
    contract: r.contractName,
    title: r.title,
    urgent: r.urgent,
  }));
  const rank = (u: ClientRequestUpdate) =>
    u.status === "waiting" ? (u.urgent ? 0 : 1) : u.status === "done_in_planner" ? 2 : 3;
  return items.sort((a, b) => rank(a) - rank(b) || b.at.getTime() - a.at.getTime());
}

async function firmTimeZone(tx: FirmTx): Promise<string> {
  const { rows } = await tx.execute<{ timezone: string }>(
    sql`select timezone from firms where id = app_current_firm_id()`,
  );
  return rows[0]?.timezone ?? "Europe/London";
}

async function seenAtOf(tx: FirmTx, officeUserId: string): Promise<Date | null> {
  const [me] = await tx
    .select({ seen: officeUsers.updatesSeenAt })
    .from(officeUsers)
    .where(eq(officeUsers.id, officeUserId));
  return me?.seen ?? null;
}

// What the bell counts: places taken, casuals' cancellations, (when they asked) uploads and client
// requests waiting for the office (sent or replied to since: Phase 36.4) since the person last
// marked Updates seen (at most the last week), on their contracts' venues.
async function countNew(
  tx: FirmTx,
  now: Date,
  seenAt: Date | null,
  sites: string[] | null,
  uploads: boolean,
): Promise<number> {
  const weekAgo = new Date(now.getTime() - UPDATES_PAGE_HOURS * 3_600_000);
  const since = seenAt && seenAt > weekAgo ? seenAt : weekAgo;
  const { rows } = await tx.execute<{ n: number }>(sql`
    select
      (select count(*) from offers o
         join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
        where o.response = 'accepted' and o.responded_at > ${since} and o.responded_at <= ${now}
          and ${sitesSql(sites)})
    + (select count(*) from assignments a
         join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
        where a.status = 'cancelled_worker' and a.cancelled_at > ${since}
          and a.cancelled_at <= ${now} and ${sitesSql(sites)})
    + (select count(*) from uploads u
        where ${uploads}::boolean and u.status = 'waiting' and u.created_at > ${since}
          and u.created_at <= ${now})
    + (select count(*) from client_requests r
        where r.status = 'waiting' and r.updated_at > ${since} and r.updated_at <= ${now}
          and ${requestSitesSql(sites)})
    as n
  `);
  return Number(rows[0]?.n ?? 0);
}

// Pay queries still with payroll sent since `since`, newest first (the newest `shown`, and whether
// there are more). A casual's, not a venue's: they show whatever the person's contracts, as
// uploads do.
async function loadPayQueries(
  tx: FirmTx,
  now: Date,
  since: Date,
  shown: number,
): Promise<{ items: PayQueryUpdate[]; more: boolean }> {
  const { rows } = await tx.execute<{
    id: string;
    created_at: string | Date;
    issue_type: PayIssue;
    work_date: string;
    first_name: string;
    last_name: string;
    event_id: string | null;
    event: string | null;
  }>(sql`
    select q.id::text as id, q.created_at, q.issue_type, q.work_date::text as work_date,
           w.first_name, w.last_name, e.id::text as event_id, e.name as event
      from pay_queries q
      join workers w on w.firm_id = q.firm_id and w.id = q.worker_id
      left join shifts s on s.firm_id = q.firm_id and s.id = q.shift_id
      left join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where q.status in ('open', 'in_digest') and q.created_at >= ${since}
       and q.created_at <= ${now}
     order by q.created_at desc, q.id
     limit ${shown + 1}
  `);
  const items = rows.slice(0, shown).map((r): PayQueryUpdate => ({
    kind: "pay-query",
    at: new Date(r.created_at),
    id: r.id,
    worker: `${r.first_name} ${r.last_name}`,
    issue: r.issue_type,
    workDate: r.work_date,
    ...(r.event_id ? { eventId: r.event_id, event: r.event ?? "" } : {}),
  }));
  return { items, more: rows.length > shown };
}

const WHO_UNKNOWN = { number: "Unknown number", address: "Unknown address", withheld: "Withheld" };

// Enquiries that need a person (the shifts line's messages and the staffing inbox's emails) and
// the app's requests waiting for an answer, sent since `since` (within the firm's message
// retention), newest first, the newest `shown` of each (and whether there are more). A casual's,
// not a venue's, as uploads are.
async function loadEnquiryUpdates(
  tx: FirmTx,
  now: Date,
  since: Date,
  shown: number,
): Promise<{ items: (EnquiryUpdate | AppRequestUpdate)[]; more: boolean }> {
  const window = await enquiryWindow(tx, now);
  const from = since > window.since ? since : window.since;
  const { rows: messages } = await tx.execute<{
    id: string;
    created_at: string | Date;
    channel: EnquiryUpdate["channel"];
    from_e164: string | null;
    from_address: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(sql`
    select m.id::text as id, m.created_at, m.channel, m.from_e164, m.from_address,
           w.first_name, w.last_name
      from ${enquirySource(from)} m
      left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
     where ${needsPerson("m")} and m.created_at <= ${now}
     order by m.created_at desc, m.id
     limit ${shown + 1}
  `);
  const { rows: requests } = await tx.execute<{
    id: string;
    created_at: string | Date;
    type: string;
    first_name: string;
    last_name: string;
    event_id: string | null;
    event: string | null;
  }>(sql`
    select q.id::text as id, q.created_at, q.type, w.first_name, w.last_name,
           e.id::text as event_id, e.name as event
      from requests q
      join workers w on w.firm_id = q.firm_id and w.id = q.worker_id
      left join shifts s on s.firm_id = q.firm_id and s.id = q.shift_id
      left join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where ${requestWaiting("q")} and q.created_at >= ${since} and q.created_at <= ${now}
     order by q.created_at desc, q.id
     limit ${shown + 1}
  `);
  const items = [
    ...messages.slice(0, shown).map((r): EnquiryUpdate => ({
      kind: "enquiry",
      at: new Date(r.created_at),
      messageId: r.id,
      who:
        r.first_name !== null
          ? `${r.first_name} ${r.last_name ?? ""}`.trim()
          : r.from_address
            ? WHO_UNKNOWN.address
            : r.from_e164
              ? WHO_UNKNOWN.number
              : WHO_UNKNOWN.withheld,
      channel: r.channel,
    })),
    ...requests.slice(0, shown).map((r): AppRequestUpdate => ({
      kind: "app-request",
      at: new Date(r.created_at),
      requestId: r.id,
      worker: `${r.first_name} ${r.last_name}`,
      type: r.type,
      ...(r.event_id ? { eventId: r.event_id, event: r.event ?? "" } : {}),
    })),
  ];
  return { items, more: messages.length > shown || requests.length > shown };
}

// "Low on cover": the events with sessions in the next LOW_COVER_DAYS that still have places to
// fill, on the person's contracts' venues, least covered first (updates-view.ts orderLowCover).
// Each event's sessions in that window only: the places they need (sessions open or filled), how
// many are booked, and how many are still open (Events & sessions' "open places").
export async function loadLowCover(
  tx: FirmTx,
  now: Date,
  sites: string[] | null,
): Promise<LowCover[]> {
  const until = new Date(now.getTime() + LOW_COVER_DAYS * 24 * 3_600_000);
  const { rows } = await tx.execute<{
    event_id: string;
    name: string;
    first_start: string | Date;
    needed: number;
    booked: number;
    to_fill: number;
  }>(sql`
    select e.id::text as event_id, e.name, min(s.starts_at) as first_start,
           sum(s.headcount)::int as needed, sum(b.booked)::int as booked,
           coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)}), 0)::int as to_fill
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
     where s.status in ('open', 'filled') and s.starts_at > ${now} and s.starts_at <= ${until}
       and ${sitesSql(sites)}
     group by e.id, e.name
    having coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)}), 0) > 0
  `);
  return orderLowCover(
    rows.map((r) => ({
      eventId: r.event_id,
      name: r.name,
      firstStart: new Date(r.first_start),
      needed: r.needed,
      booked: r.booked,
      toFill: r.to_fill,
    })),
  ).slice(0, LOW_COVER_SHOWN);
}

// One event's name in the firm (the filter's choice when nothing of it is in the period), or null.
async function eventName(tx: FirmTx, eventId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ name: string }>(
    sql`select name from shift_events where id = ${eventId}::uuid`,
  );
  return rows[0]?.name ?? null;
}

export async function loadUpdatesPage(
  tx: FirmTx,
  now: Date,
  officeUserId: string,
  view: UpdatesView = DEFAULT_VIEW,
): Promise<UpdatesPage> {
  const timeZone = await firmTimeZone(tx);
  const sites = await mySites(tx, officeUserId);
  const seenAt = await seenAtOf(tx, officeUserId);
  const tellMe = await loadTellMe(tx, officeUserId);
  const kinds = kindsFor({
    pay: await officeUserMay(tx, officeUserId, "pay"),
    enquiries: await officeUserMay(tx, officeUserId, "enquiries"),
  });
  const since = periodStart(view.period, now, timeZone);
  const none = { items: [], more: false };
  const [events, soon, toMark, requests, pay, enquiries] = [
    await loadUpdates(tx, now, sites, { since, shown: UPDATES_PAGE_SHOWN }),
    await loadOpenSoon(tx, now, sites),
    await loadToMark(tx, now, sites),
    await loadClientRequestUpdates(tx, now, sites),
    kinds.includes("pay") ? await loadPayQueries(tx, now, since, UPDATES_PAGE_SHOWN) : none,
    kinds.includes("enquiries")
      ? await loadEnquiryUpdates(tx, now, since, UPDATES_PAGE_SHOWN)
      : none,
  ];
  // Places still open, soonest start first; sessions to mark; client requests; then the rest,
  // newest first.
  const happened: PageUpdate[] = [...events.items, ...pay.items, ...enquiries.items].sort(
    (a, b) => b.at.getTime() - a.at.getTime(),
  );
  // Client requests (Phase 36.4) stand with what needs doing now: urgent ones first, as loaded.
  const period: PageUpdate[] = [...soon, ...toMark, ...requests, ...happened];
  // The event: one with something in the period, or one of the firm's with nothing in it yet.
  const choices = eventChoices(period);
  let eventId = view.eventId;
  if (eventId && !choices.some((c) => c.id === eventId)) {
    const name = await eventName(tx, eventId);
    if (name === null) eventId = null;
    else choices.push({ id: eventId, name });
  }
  const items = eventId ? period.filter((u) => eventOf(u)?.id === eventId) : period;
  const counts = Object.fromEntries(
    UPDATE_KINDS.map((k) => [k, kinds.includes(k) ? items.filter((u) => inKind(u, k)).length : 0]),
  ) as Record<UpdateKind, number>;
  const kind = kinds.includes(view.kind) ? view.kind : DEFAULT_VIEW.kind;
  const today = localDateOf(now, timeZone);
  const fromEvents = new Set<PageUpdate>(events.items);
  return {
    timeZone,
    now,
    mine: sites !== null,
    seenAt,
    tellMe,
    newCount: await countNew(tx, now, seenAt, sites, tellMe.includes("uploads")),
    // As always: the sessions' news and uploads (events.items) since midnight.
    today: items.filter((u) => fromEvents.has(u) && localDateOf(u.at, timeZone) === today).length,
    view: { period: view.period, eventId, kind },
    kinds,
    counts,
    events: choices,
    shown: items.filter((u) => inKind(u, kind)),
    needsAction: items.filter(needsAction),
    everything: items,
    more: events.more || pay.more || enquiries.more,
    lowCover: await loadLowCover(tx, now, sites),
  };
}

// The page for an admin or resourcer, or null.
export async function officeUpdatesPage(
  ctx: OfficeContext,
  view: UpdatesView = DEFAULT_VIEW,
): Promise<UpdatesPage | null> {
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "today"))
      ? loadUpdatesPage(tx, now, ctx.officeUserId, view)
      : null,
  );
}

// "Mark all as seen": what the page showed has been seen (the bell starts again from there).
// `shownAt` is the time the page was drawn, so an update landing after it stays new; never later
// than now, and it only moves forward (two tabs, or an old page sending late). A read marker, like a
// casual's Messages one: not an action, so not logged.
export async function markUpdatesSeen(ctx: OfficeContext, shownAt: Date): Promise<boolean> {
  const now = (ctx.clock ?? systemClock).now();
  const seen = shownAt.getTime() < now.getTime() ? shownAt : now;
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return false;
    await tx
      .update(officeUsers)
      .set({ updatesSeenAt: sql`greatest(${officeUsers.updatesSeenAt}, ${seen})` })
      .where(eq(officeUsers.id, ctx.officeUserId));
    return true;
  });
}

// --- For the 08:00 summary (src/lib/office/alerts.ts): counted, not capped like the page's list ---

export interface SummaryCounts {
  took: number;
  cancelled: number; // casuals' cancellations
  under48: number; // of those, under 48 hours' notice
  uploads: number; // photos and certificates sent and still waiting
  clientRequests: number; // client requests sent (Phase 36.4)
}

// What happened on the person's contracts in (from, now].
export async function countSince(
  tx: FirmTx,
  from: Date,
  now: Date,
  sites: string[] | null,
): Promise<SummaryCounts> {
  const { rows } = await tx.execute<{
    took: number;
    cancelled: number;
    under48: number;
    uploads: number;
    client_requests: number;
  }>(sql`
    with c as (
      select a.notice_hours from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
       where a.status = 'cancelled_worker' and a.cancelled_at > ${from}
         and a.cancelled_at <= ${now} and ${sitesSql(sites)})
    select
      (select count(*)::int from offers o
         join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
        where o.response = 'accepted' and o.responded_at > ${from} and o.responded_at <= ${now}
          and ${sitesSql(sites)}) as took,
      (select count(*)::int from c) as cancelled,
      (select count(*)::int from c where c.notice_hours < 48) as under48,
      (select count(*)::int from uploads u
        where u.status = 'waiting' and u.created_at > ${from} and u.created_at <= ${now}) as uploads,
      (select count(*)::int from client_requests r
        where r.created_at > ${from} and r.created_at <= ${now}
          and ${requestSitesSql(sites)}) as client_requests
  `);
  const r = rows[0];
  return {
    took: r?.took ?? 0,
    cancelled: r?.cancelled ?? 0,
    under48: r?.under48 ?? 0,
    uploads: r?.uploads ?? 0,
    clientRequests: r?.client_requests ?? 0,
  };
}

// How many things need action now, as Updates' "Needs action" lists them (every one, uncapped):
// places still to fill near their start, the week's cancellations whose place is open again, the
// week's uploads waiting for a check, sessions to mark, and client requests waiting for the office
// or still to do in the planner (Phase 36.4).
export async function countNeedsAction(
  tx: FirmTx,
  now: Date,
  sites: string[] | null,
): Promise<number> {
  const weekAgo = new Date(now.getTime() - UPDATES_PAGE_HOURS * 3_600_000);
  const { rows } = await tx.execute<{ n: number }>(sql`
    select
      (select count(*) from shifts s ${bookedJoin}
        where ${placeFree(now)}
          and s.starts_at <= ${new Date(now.getTime() + OPEN_SOON_HOURS * 3_600_000)}
          and ${sitesSql(sites)})
    + (select count(*) from assignments a
         join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
         ${bookedJoin}
        where a.status = 'cancelled_worker' and a.cancelled_at >= ${weekAgo}
          and a.cancelled_at <= ${now} and ${placeFree(now)} and ${sitesSql(sites)})
    + (select count(*) from uploads u
        where u.status = 'waiting' and u.created_at >= ${weekAgo} and u.created_at <= ${now})
    + (select count(*) from shifts s
        where s.status <> 'cancelled'
          and s.ends_at <= ${new Date(now.getTime() - MARK_AFTER_HOURS * 3_600_000)}
          and s.ends_at > ${new Date(now.getTime() - MARK_LOOKBACK_DAYS * 24 * 3_600_000)}
          and ${sitesSql(sites)}
          and exists (select 1 from assignments a
                       where a.firm_id = s.firm_id and a.shift_id = s.id
                         and a.worker_id is not null and a.status = 'confirmed'))
    + (select count(*) from client_requests r
        where (r.status = 'waiting'
               or (r.status = 'done_in_planner' and r.planner_done_at is null))
          and ${requestSitesSql(sites)})
    as n
  `);
  return Number(rows[0]?.n ?? 0);
}

// --- The bell and the pop-up (the office frame) -------------------------------------------------

export interface NewCancellation {
  ref: string; // the booking's id: its record
  at: Date; // when they cancelled
  shiftId: string;
  worker: string;
  role: string;
  site: string | null;
  startsAt: Date;
  noticeHours: number;
  reopened: boolean; // the place is open again
}

export interface UpdatesBell {
  newCount: number; // places taken, cancellations and uploads since Updates was marked seen
  cancellations: NewCancellation[]; // a casual's, in the last POPUP_MINUTES and since then (none
  // when they switched the pop-up off)
  today: string; // yyyy-mm-dd, the firm's calendar (for the pop-up's day)
  timeZone: string;
  now: Date; // the server's time of this read: a browser tab pops up only what lands after it opened
}

export async function loadUpdatesBell(
  tx: FirmTx,
  now: Date,
  officeUserId: string,
): Promise<UpdatesBell> {
  const timeZone = await firmTimeZone(tx);
  const seenAt = await seenAtOf(tx, officeUserId);
  const sites = await mySites(tx, officeUserId);
  const tellMe = await loadTellMe(tx, officeUserId);
  const popSince = new Date(
    Math.max(seenAt?.getTime() ?? 0, now.getTime() - POPUP_MINUTES * 60_000),
  );
  const { rows: cancelled } = await tx.execute<{
    ref: string;
    cancelled_at: string | Date;
    shift_id: string;
    first_name: string;
    last_name: string;
    role: string;
    site: string | null;
    starts_at: string | Date;
    notice_hours: string | number;
    reopened: boolean;
  }>(sql`
    select a.id::text as ref, a.cancelled_at, s.id::text as shift_id, w.first_name, w.last_name,
           s.role,
           coalesce(si.name, esi.name) as site, s.starts_at, a.notice_hours,
           (${placeFree(now)}) as reopened
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      ${bookedJoin}
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
     where ${tellMe.includes("popup")}::boolean and a.status = 'cancelled_worker'
       and a.cancelled_at > ${popSince}
       and a.cancelled_at <= ${now} and ${sitesSql(sites)}
     order by a.cancelled_at desc, a.id
     limit 5
  `);
  return {
    newCount: await countNew(tx, now, seenAt, sites, tellMe.includes("uploads")),
    cancellations: cancelled.map((r) => ({
      ref: r.ref,
      at: new Date(r.cancelled_at),
      shiftId: r.shift_id,
      worker: `${r.first_name} ${r.last_name}`,
      role: r.role,
      site: r.site,
      startsAt: new Date(r.starts_at),
      noticeHours: Number(r.notice_hours),
      reopened: r.reopened,
    })),
    today: localDateOf(now, timeZone),
    timeZone,
    now,
  };
}
