import { eq, sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { errorCode } from "../jobs/firm-job";
import { log } from "../log";
import { OFFICE_REPLY_PREFIX } from "../notices/enquiry-reply";
import type { StopReason } from "../offers/waves";
import { strikeSettings } from "../strikes/settings";
import { rulesSettingsSchema } from "../roster/eligibility-input";
import { localDateOf, wallTimeOf, zonedToUtc } from "../time/zoned";
import { loadCancellations } from "./cancellations";
import type { CancellationRow } from "./cancellations-copy";
import { waitingCount } from "./casuals";
import { loadEnquiries, type EnquiryRow } from "./enquiries";
import { bookedJoin, loadEventCards, urgentGap, type EventCardData } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import {
  loadBookingsToCheck,
  loadEvidence,
  loadSheetIssues,
  loadToMark,
  loadUrgentOffers,
  type TodayBookingToCheck,
  type TodayEvidence,
  type TodaySheetIssue,
  type TodayToMark,
} from "./today";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`): four counts, each a
// link to its list, then urgent shifts not filled, events showing to casuals, the latest
// cancellations and enquiries, and Needs attention (the to-dos; the bell in the top bar counts its
// items). Reads only, inside the firm (RLS scopes every row), for admins and resourcers (checked
// here as well as on the page). It reuses today.ts's queries (the urgent shifts and their offers,
// and the to-dos), Events' cards, and the Cancellations and Enquiries loaders. "Today" is the
// firm's calendar day (London).
//
// Each part is read in its own savepoint: one that fails shows its error words and the rest of
// the page still shows (a failed query would otherwise end the whole transaction).

export const LATEST_CANCELLATIONS = 3;
export const LATEST_ENQUIRIES = 4;
export const SHOWING_EVENTS = 6; // cards in "Showing to casuals"; the count links to them all
export const SHOWING_SESSIONS = 2; // sessions on each of those cards, then "+ N more"
export const NEEDS_MAX = 50; // each Needs attention list stops here ("more" says there were others)

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

// A part of the page: its data, or that it couldn't be read.
export type Part<T> = { ok: true; data: T } | { ok: false };

export interface DashboardCounts {
  // Sessions marked urgent, open, not started, with a place free (Events' "Urgent, not filled").
  urgent: Part<{ sessions: number; places: number; firstStartsAt: Date | null }>;
  // Events switched on with a session to come (Events' "Showing"); their open sessions (open, not
  // started, switched on, with a place free) and those places.
  showing: Part<{ events: number; sessions: number; places: number }>;
  // Bookings cancelled since midnight, by anyone; those under the strike notice; strikes issued.
  cancellations: Part<{ total: number; underNotice: number; strikes: number; threshold: number }>;
  // Messages to the shifts line since midnight plus requests made in the app; those answered
  // without a person; and how many need a person now.
  enquiries: Part<{ total: number; automatic: number; needPerson: number }>;
}

// An urgent session with a gap, on its event's card, with the facts its line is written from.
export interface UrgentSessionCard {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  placesLeft: number;
  fromSheet: boolean;
  fromPlanner: boolean; // sent by the firm's planner through the API (12J.1)
  showing: boolean; // the session's own switch (the event's is on its card)
  offered: number; // offers that went (waves and the office)
  stopped: StopReason | null; // why the waves stopped, if they have
  escalated: boolean; // the office was emailed about it
}

export interface UrgentEventCard {
  eventId: string;
  name: string;
  place: string | null;
  showing: boolean; // the event's switch: hidden means nobody can see the gap
  sessions: UrgentSessionCard[];
}

// A booked session whose required qualification (the role's or the session's own) won't be in
// date: its records ran out, or run out, before the session's last day (read as the rules read
// it: docs/rules-and-credentials.md, check 3).
export interface ExpiredOnBooking {
  assignmentId: string;
  workerId: string;
  worker: string;
  shiftId: string;
  role: string;
  startsAt: Date;
  type: string;
  credential: string; // its name for people
  expiresOn: string | null; // yyyy-mm-dd (null: marked expired by the office)
}

// A change your planner sent for a booked session that was refused (docs/office-v2.md 5.3.2
// step 5): a move the rules refused for some booked casuals ("move"), or a role, requirements or
// places change that a booking blocks (the API's own codes). The planner may ignore the 409, so
// the office is told here.
export interface PlannerRefusal {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  refusedAt: Date;
  why: "move" | "session_has_bookings" | "places_below_booked";
  casuals: number; // for a move: the booked casuals who can't work it
}

export interface NeedsAttention {
  toCheck: TodayBookingToCheck[];
  toCheckMore: boolean;
  fromSheet: TodaySheetIssue[];
  fromSheetMore: boolean;
  toMark: TodayToMark[];
  toMarkMore: boolean;
  expired: ExpiredOnBooking[];
  expiredMore: boolean;
  uploads: number; // uploads waiting for a check (12F.2)
  evidence: TodayEvidence;
  plannerRefused: PlannerRefusal[];
  plannerRefusedMore: boolean;
}

export interface Dashboard {
  timeZone: string;
  today: string; // yyyy-mm-dd, the firm's calendar
  counts: DashboardCounts;
  urgent: Part<{ events: UrgentEventCard[]; more: boolean }>;
  showing: Part<{ events: EventCardData[]; more: number }>;
  cancellations: Part<{ rows: CancellationRow[]; threshold: number }>;
  enquiries: Part<{ rows: EnquiryRow[]; replies: Record<string, string | null> }>;
  needs: Part<NeedsAttention>;
}

// "Strike evidence" items: each failed email, and the strikes team's address while it isn't set
// and confirmed.
export const evidenceItems = (e: TodayEvidence) => e.failed.length + (e.addressConfirmed ? 0 : 1);

// The bell's number: every item in Needs attention ("more": a list stopped at 50).
export function needsCount(n: NeedsAttention): { count: number; more: boolean } {
  return {
    count:
      n.toCheck.length +
      n.fromSheet.length +
      n.toMark.length +
      n.expired.length +
      n.uploads +
      evidenceItems(n.evidence) +
      n.plannerRefused.length,
    more:
      n.toCheckMore ||
      n.fromSheetMore ||
      n.toMarkMore ||
      n.expiredMore ||
      n.evidence.failedMore ||
      n.plannerRefusedMore,
  };
}

export async function part<T>(
  tx: FirmTx,
  name: string,
  load: (sp: FirmTx) => Promise<T>,
): Promise<Part<T>> {
  try {
    return { ok: true, data: await tx.transaction((sp) => load(sp)) };
  } catch (err) {
    log.error("dashboard: a part couldn't be read", { part: name, code: errorCode(err) });
    return { ok: false };
  }
}

async function firmFacts(tx: FirmTx) {
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return { timeZone: firm?.timezone ?? "Europe/London", settings: firm?.settings ?? {} };
}

export const midnightOf = (now: Date, timeZone: string): Date =>
  zonedToUtc({ ...wallTimeOf(now, timeZone), hour: 0, minute: 0 }, timeZone);

async function urgentCount(tx: FirmTx, now: Date) {
  const { rows } = await tx.execute<{
    sessions: number;
    places: number;
    first: string | Date | null;
  }>(sql`
    select count(*)::int as sessions, coalesce(sum(s.headcount - b.booked), 0)::int as places,
           min(s.starts_at) as first
      from shifts s
      ${bookedJoin}
     where ${urgentGap(now)}
  `);
  const r = rows[0];
  return {
    sessions: r?.sessions ?? 0,
    places: r?.places ?? 0,
    firstStartsAt: r?.first ? new Date(r.first) : null,
  };
}

async function showingCount(tx: FirmTx, now: Date) {
  const { rows } = await tx.execute<{ events: number; sessions: number; places: number }>(sql`
    select (select count(distinct e.id)::int
              from shift_events e
              join shifts s on s.firm_id = e.firm_id and s.event_id = e.id
             where e.showing_to_casuals and s.ends_at > ${now} and s.status <> 'cancelled')
             as events,
           count(*)::int as sessions, coalesce(sum(s.headcount - b.booked), 0)::int as places
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
     where e.showing_to_casuals and s.showing_to_casuals and s.status = 'open'
       and s.starts_at > ${now} and b.booked < s.headcount
  `);
  const r = rows[0];
  return { events: r?.events ?? 0, sessions: r?.sessions ?? 0, places: r?.places ?? 0 };
}

async function cancellationCount(tx: FirmTx, now: Date, midnight: Date, threshold: number) {
  const { rows } = await tx.execute<{ total: number; under: number; strikes: number }>(sql`
    select count(*)::int as total,
           count(*) filter (where a.notice_hours < ${threshold})::int as under,
           (select count(*)::int from strikes st
             where st.issued_at >= ${midnight} and st.issued_at <= ${now}) as strikes
      from assignments a
     where a.status in (${CANCELLED}) and a.cancelled_at >= ${midnight}
       and a.cancelled_at <= ${now}
  `);
  const r = rows[0];
  return {
    total: r?.total ?? 0,
    underNotice: r?.under ?? 0,
    strikes: r?.strikes ?? 0,
    threshold,
  };
}

// Urgent sessions with a gap, on their events' cards: Events' own cards (only their urgent gaps
// kept), with the offers of each session shown (today.ts).
async function urgentCards(tx: FirmTx, now: Date) {
  const { events, more } = await loadEventCards(tx, now, "urgent", Number.MAX_SAFE_INTEGER);
  const offers = await loadUrgentOffers(
    tx,
    events.flatMap((e) => e.sessions.filter((s) => s.urgentGap).map((s) => s.shiftId)),
  );
  return {
    more,
    events: events.map((e): UrgentEventCard => ({
      eventId: e.eventId,
      name: e.name,
      place: e.place,
      showing: e.showing,
      sessions: e.sessions
        .filter((s) => s.urgentGap)
        .map((s) => {
          const o = offers.get(s.shiftId);
          return {
            shiftId: s.shiftId,
            role: s.role,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            headcount: s.headcount,
            placesLeft: Math.max(0, s.headcount - s.booked),
            fromSheet: s.fromSheet,
            fromPlanner: s.fromPlanner,
            showing: s.showing,
            offered: o?.offered ?? 0,
            stopped: o?.stopped ?? null,
            escalated: o?.escalated ?? false,
          };
        }),
    })),
  };
}

// The first line of the reply each message got (null: none yet): an automatic reply (stored once
// it's sent) or the office's own words once they've gone. The office's reply is stored before it's
// sent, under a placeholder id until then; one still waiting, or that failed, isn't one they got.
async function firstReplies(tx: FirmTx, ids: string[]): Promise<Record<string, string | null>> {
  const replies: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, null]));
  if (ids.length === 0) return replies;
  const { rows } = await tx.execute<{ reply_to: string; body: string | null }>(sql`
    select distinct on (m.reply_to) m.reply_to::text as reply_to, m.body
      from messages m
     where m.direction = 'out' and m.reply_to in (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
       and not starts_with(m.provider_message_id, ${OFFICE_REPLY_PREFIX})
     order by m.reply_to, m.created_at, m.id
  `);
  for (const r of rows) {
    const line = (r.body ?? "").split("\n")[0]?.trim() ?? "";
    replies[r.reply_to] = line === "" ? null : line;
  }
  return replies;
}

// Booked sessions to come whose required qualification won't be in date by their last day.
export async function loadExpiredOnBookings(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<{ items: ExpiredOnBooking[]; more: boolean }> {
  // An application in progress counts as the rules engine counts it (src/lib/rules/eligibility.ts,
  // check 4; as src/lib/credentials/qualifications.ts reads it): a type that allows it, at a firm
  // with an allowance above 0. The booking was checked against the day's share when it was made.
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const rulesSettings = rulesSettingsSchema.safeParse(firm?.settings ?? {});
  const appliedCounts =
    rulesSettings.success && rulesSettings.data.credential_applied_allowance_pct > 0;
  const { rows } = await tx.execute<{
    assignment_id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
    shift_id: string;
    role: string;
    starts_at: string | Date;
    type: string;
    type_name: string | null;
    expires_on: string | null;
  }>(sql`
    with booked as (
      select a.id as assignment_id, a.worker_id, s.id as shift_id, s.role, s.starts_at,
             s.required_credentials,
             greatest((s.starts_at at time zone ${timeZone})::date,
                      ((s.ends_at - interval '1 millisecond') at time zone ${timeZone})::date)
               as last_day
        from assignments a
        join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
       where a.status = 'confirmed' and s.status in ('open', 'filled') and s.starts_at > ${now}
    ),
    needed as (
      select b.*, t.type
        from booked b
        left join credential_rules r on r.firm_id = app_current_firm_id() and r.role = b.role
        cross join lateral (
          select distinct x as type
            from unnest(coalesce(r.required_types, '{}'::text[]) || b.required_credentials) x
        ) t
    )
    select n.assignment_id::text, n.worker_id::text, w.first_name, w.last_name,
           n.shift_id::text, n.role, n.starts_at, n.type, ct.name as type_name,
           -- The date it ran out, from records dated before the session's last day (one marked
           -- expired with a later date, or none, reads "marked as expired").
           (select max(c.expires_on)::text from credentials c
             where c.firm_id = w.firm_id and c.worker_id = n.worker_id and c.type = n.type
               and c.check_state = 'verified' and c.status in ('expired', 'valid')
               and c.expires_on < n.last_day)
             as expires_on
      from needed n
      join workers w on w.firm_id = app_current_firm_id() and w.id = n.worker_id
      left join credential_types ct on ct.firm_id = w.firm_id and ct.code = n.type
     where exists (select 1 from credentials c
                    where c.firm_id = w.firm_id and c.worker_id = n.worker_id and c.type = n.type
                      and c.check_state = 'verified'
                      and (c.status = 'expired'
                           or (c.status = 'valid' and c.expires_on < n.last_day)))
       -- Not when a checked record is in date (the rules pass), an application in progress counts
       -- (above), or one is suspended (another reason).
       and not exists (select 1 from credentials c
                        where c.firm_id = w.firm_id and c.worker_id = n.worker_id
                          and c.type = n.type and c.check_state = 'verified'
                          and (c.status = 'suspended'
                               or (c.status = 'valid'
                                   and (c.expires_on is null or c.expires_on >= n.last_day))
                               or (${appliedCounts} and c.status = 'applied'
                                   and coalesce(ct.applied_allowed, false))))
     order by n.starts_at, w.last_name, w.first_name, n.type
     limit ${NEEDS_MAX + 1}
  `);
  return {
    more: rows.length > NEEDS_MAX,
    items: rows.slice(0, NEEDS_MAX).map((r) => ({
      assignmentId: r.assignment_id,
      workerId: r.worker_id,
      worker: `${r.first_name} ${r.last_name}`,
      shiftId: r.shift_id,
      role: r.role,
      startsAt: new Date(r.starts_at),
      type: r.type,
      credential: r.type_name ?? r.type.replace(/_/g, " ").toLowerCase(),
      expiresOn: r.expires_on,
    })),
  };
}

// Your planner's refused changes, worked out from the log (no schema change): each of its sessions
// that hasn't ended or been cancelled whose latest refusal (shift.move_refused from the API, or
// api.change_refused) has nothing logged after it that changed or cancelled the session:
// shift.changed or shift.cancelled_by_firm on the session, or shift.moved, shift.curtailed or
// shift.cancelled on one of its bookings (by anyone: the bookings that blocked it may be gone).
// "After" is by entry id, the log's own order. Like a rota sheet's refused change, it stays until
// the session ends: nothing else can clear it once it has started. Every look-up here goes through
// the log's (firm, entity, id) index, from the planner's sessions still to come.
export async function loadPlannerRefusals(
  tx: FirmTx,
  now: Date,
): Promise<{ items: PlannerRefusal[]; more: boolean }> {
  const { rows } = await tx.execute<{
    shift_id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    site_name: string | null;
    action: string;
    code: string | null;
    casuals: number;
    refused_at: string | Date;
  }>(sql`
    select s.id::text as shift_id, s.role, s.starts_at, s.ends_at, si.name as site_name,
           r.action, r.code, r.casuals, r.created_at as refused_at
      from shifts s
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      cross join lateral (
        select e.id, e.action, e.data ->> 'code' as code, e.created_at,
               case when jsonb_typeof(e.data -> 'workers') = 'array'
                    then jsonb_array_length(e.data -> 'workers') else 0 end as casuals
          from events e
         where e.firm_id = s.firm_id and e.entity_id = s.id and e.data ->> 'via' = 'api'
           and (e.action = 'shift.move_refused'
                or (e.action = 'api.change_refused'
                    and e.data ->> 'code' in ('session_has_bookings', 'places_below_booked')))
         order by e.id desc
         limit 1
      ) r
     where s.source = 'api' and s.status <> 'cancelled' and s.ends_at > ${now}
       and not exists (select 1 from events c
                        where c.firm_id = s.firm_id and c.entity_id = s.id and c.id > r.id
                          and c.action in ('shift.changed', 'shift.cancelled_by_firm'))
       and not exists (select 1 from assignments a
                         join events c on c.firm_id = a.firm_id and c.entity_id = a.id
                        where a.firm_id = s.firm_id and a.shift_id = s.id and c.id > r.id
                          and c.action in ('shift.moved', 'shift.curtailed', 'shift.cancelled'))
     order by s.starts_at, s.id
     limit ${NEEDS_MAX + 1}
  `);
  return {
    more: rows.length > NEEDS_MAX,
    items: rows.slice(0, NEEDS_MAX).map((r) => ({
      shiftId: r.shift_id,
      role: r.role,
      site: r.site_name,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      refusedAt: new Date(r.refused_at),
      why:
        r.action === "shift.move_refused"
          ? "move"
          : r.code === "places_below_booked"
            ? "places_below_booked"
            : "session_has_bookings",
      casuals: r.action === "shift.move_refused" ? r.casuals : 0,
    })),
  };
}

export async function loadNeedsAttention(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<NeedsAttention> {
  const toCheck = await loadBookingsToCheck(tx, now);
  const fromSheet = await loadSheetIssues(tx, now);
  const toMark = await loadToMark(tx, now);
  const expired = await loadExpiredOnBookings(tx, now, timeZone);
  const plannerRefused = await loadPlannerRefusals(tx, now);
  return {
    toCheck: toCheck.items,
    toCheckMore: toCheck.more,
    fromSheet: fromSheet.items,
    fromSheetMore: fromSheet.more,
    toMark: toMark.items,
    toMarkMore: toMark.more,
    expired: expired.items,
    expiredMore: expired.more,
    uploads: await waitingCount(tx),
    evidence: await loadEvidence(tx, now),
    plannerRefused: plannerRefused.items,
    plannerRefusedMore: plannerRefused.more,
  };
}

export async function loadDashboard(tx: FirmTx, now: Date): Promise<Dashboard> {
  const { timeZone, settings } = await firmFacts(tx);
  const midnight = midnightOf(now, timeZone);
  const threshold = strikeSettings(settings).noticeHours;
  const enquiries = await part(tx, "enquiries", async (sp) => {
    const page = await loadEnquiries(sp, "all", now, { limit: LATEST_ENQUIRIES });
    return {
      page,
      replies: await firstReplies(
        sp,
        page.rows.map((r) => r.messageId),
      ),
    };
  });
  return {
    timeZone,
    today: localDateOf(now, timeZone),
    counts: {
      urgent: await part(tx, "urgent count", (sp) => urgentCount(sp, now)),
      showing: await part(tx, "showing count", (sp) => showingCount(sp, now)),
      cancellations: await part(tx, "cancellations count", (sp) =>
        cancellationCount(sp, now, midnight, threshold),
      ),
      enquiries: enquiries.ok
        ? {
            ok: true,
            data: {
              total: enquiries.data.page.today + enquiries.data.page.appToday,
              automatic: enquiries.data.page.automaticToday,
              needPerson: enquiries.data.page.needPerson.count,
            },
          }
        : { ok: false },
    },
    urgent: await part(tx, "urgent", (sp) => urgentCards(sp, now)),
    showing: await part(tx, "showing", async (sp) => {
      const { events } = await loadEventCards(sp, now, "showing", SHOWING_SESSIONS);
      const shown = events.slice(0, SHOWING_EVENTS);
      // The rest, counted as the count counts them (the card list itself stops at 50).
      const total = (await showingCount(sp, now)).events;
      return { events: shown, more: Math.max(0, total - shown.length) };
    }),
    cancellations: await part(tx, "cancellations", async (sp) => {
      const list = await loadCancellations(sp, {
        view: "all",
        now,
        limit: LATEST_CANCELLATIONS,
      });
      return { rows: list.rows, threshold: list.threshold };
    }),
    enquiries: enquiries.ok
      ? { ok: true, data: { rows: enquiries.data.page.rows, replies: enquiries.data.replies } }
      : { ok: false },
    needs: await part(tx, "needs", (sp) => loadNeedsAttention(sp, now, timeZone)),
  };
}

// The dashboard for an admin or resourcer, or null (anyone else, or logged out).
export async function officeDashboard(ctx: OfficeContext): Promise<Dashboard | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "today")) ? loadDashboard(tx, now) : null,
  );
}

// The bell in the top bar: how many items Needs attention holds (null for anyone without the
// dashboard; a null count when it couldn't be read: the bell then shows no number).
export async function needsAttentionBell(
  ctx: OfficeContext,
): Promise<{ count: number | null; more: boolean } | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return null;
    const { timeZone } = await firmFacts(tx);
    const needs = await part(tx, "bell", (sp) => loadNeedsAttention(sp, now, timeZone));
    return needs.ok ? needsCount(needs.data) : { count: null, more: false };
  });
}
