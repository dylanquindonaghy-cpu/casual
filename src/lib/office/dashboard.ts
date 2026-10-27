import { eq, sql, type SQL } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { errorCode } from "../jobs/firm-job";
import { log } from "../log";
import { rulesSettingsSchema } from "../roster/eligibility-input";
import { localDateOf } from "../time/zoned";
import { waitingCount, waitingUploads, type WaitingUpload } from "./casuals";
import { needPersonCount } from "./enquiries";
import { bookedJoin, urgentGap } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import {
  LIST_MAX,
  loadBookingsToCheck,
  loadEvidence,
  loadSheetIssues,
  loadToMark,
  type TodayBookingToCheck,
  type TodayEvidence,
  type TodaySheetIssue,
  type TodayToMark,
} from "./today";
import { webhookStatus } from "./webhook-settings";

// Needs attention (docs/office-v2.md 3.2, 3.9; Phases 18 and 20): the office's to-dos, its page and
// the menu's count, read inside the firm (RLS scopes every row), for admins and resourcers
// (checked here as well as on the page). It reuses today.ts's queries for the to-dos. "Today" is
// the firm's calendar day (London). Each part is read in its own savepoint (part()): one that
// fails shows its error words and the rest of the page still shows (a failed query would
// otherwise end the whole transaction). The office dashboard itself is dashboard-board.ts
// (Phase 24), whose parts are read the same way; Phase 23's count cards, urgent cards and charts
// were read here until then.

export const NEEDS_MAX = 50; // each Needs attention list stops here ("more" says there were others)

// A part of the page: its data, or that it couldn't be read.
export type Part<T> = { ok: true; data: T } | { ok: false };

// Sessions marked urgent, open, not started, with a place free (Events' "Urgent, not filled"):
// Needs attention's "Also needs you".
export type UrgentCount = Part<{ sessions: number; places: number; firstStartsAt: Date | null }>;

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
// step 5): a move the rules refused for some booked casuals ("move"), a role, requirements or
// places change that a booking blocks, or a move or cancellation of a booked session sent with no
// reason (the API's own codes). The planner may ignore the 409 or 422, so the office is told here.
export interface PlannerRefusal {
  shiftId: string;
  role: string;
  site: string | null;
  startsAt: Date;
  endsAt: Date;
  refusedAt: Date;
  why: "move" | "session_has_bookings" | "places_below_booked" | "change_reason_required";
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
  uploadList: WaitingUpload[]; // the first LIST_MAX of them, oldest first (Phase 20)
  evidence: TodayEvidence;
  plannerRefused: PlannerRefusal[];
  plannerRefusedMore: boolean;
  // Your planner's webhook is failing (12J.2): its latest delivery gave up after the last try, and
  // the address is still set. One item, from the first failure since it last worked.
  webhookFailing: { since: Date } | null;
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
      n.plannerRefused.length +
      (n.webhookFailing ? 1 : 0),
    more:
      n.toCheckMore ||
      n.fromSheetMore ||
      n.toMarkMore ||
      n.expiredMore ||
      n.evidence.failedMore ||
      n.plannerRefusedMore,
  };
}

// One count of what needs a person in the office (Phase 20): Needs attention's items and the
// enquiries that need a person, as the menu's "Needs attention" shows it and the dashboard's
// headline adds the urgent places to.
export function attentionCount(
  n: NeedsAttention,
  needPerson: number,
): { count: number; more: boolean } {
  const items = needsCount(n);
  return { count: items.count + needPerson, more: items.more };
}

// Needs attention's page count from its parts: null when the items couldn't be read; "at least"
// (`more`) when the enquiries that need a person couldn't be.
export function attentionOf(
  needs: Part<NeedsAttention>,
  needPerson: Part<number>,
): { count: number; more: boolean } | null {
  if (!needs.ok) return null;
  const n = attentionCount(needs.data, needPerson.ok ? needPerson.data : 0);
  return { ...n, more: n.more || !needPerson.ok };
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

// The rule for a booked session's qualification not in date (read as the rules read it:
// docs/rules-and-credentials.md, check 3), as a query of its own: one row for each confirmed
// booking on a session to come (open or filled) and each qualification it needs (the role's and the
// session's own) that won't be in date by the session's last day (the firm's calendar), with
// columns firm_id, assignment_id, worker_id, shift_id, role, starts_at, type and last_day. Every
// row, never capped: Needs attention lists the first 50 (loadExpiredOnBookings; Phase 23's licences
// chart read the same rows until Phase 24). Reads the firm's rules settings
// in `tx`; the rows stay the firm's (RLS).
export async function outOfDateBookings(tx: FirmTx, now: Date, timeZone: string): Promise<SQL> {
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
  return sql`
    with booked as (
      select a.firm_id, a.id as assignment_id, a.worker_id, s.id as shift_id, s.role, s.starts_at,
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
        left join credential_rules r on r.firm_id = b.firm_id and r.role = b.role
        cross join lateral (
          select distinct x as type
            from unnest(coalesce(r.required_types, '{}'::text[]) || b.required_credentials) x
        ) t
    )
    select n.firm_id, n.assignment_id, n.worker_id, n.shift_id, n.role, n.starts_at, n.type,
           n.last_day
      from needed n
      left join credential_types ct on ct.firm_id = n.firm_id and ct.code = n.type
     where exists (select 1 from credentials c
                    where c.firm_id = n.firm_id and c.worker_id = n.worker_id and c.type = n.type
                      and c.check_state = 'verified'
                      and (c.status = 'expired'
                           or (c.status = 'valid' and c.expires_on < n.last_day)))
       -- Not when a checked record is in date (the rules pass), an application in progress counts
       -- (above), or one is suspended (another reason).
       and not exists (select 1 from credentials c
                        where c.firm_id = n.firm_id and c.worker_id = n.worker_id
                          and c.type = n.type and c.check_state = 'verified'
                          and (c.status = 'suspended'
                               or (c.status = 'valid'
                                   and (c.expires_on is null or c.expires_on >= n.last_day))
                               or (${appliedCounts} and c.status = 'applied'
                                   and coalesce(ct.applied_allowed, false))))`;
}

// Booked sessions to come whose required qualification won't be in date by their last day
// (outOfDateBookings), soonest first: the first NEEDS_MAX.
export async function loadExpiredOnBookings(
  tx: FirmTx,
  now: Date,
  timeZone: string,
): Promise<{ items: ExpiredOnBooking[]; more: boolean }> {
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
    with out_of_date as (${await outOfDateBookings(tx, now, timeZone)})
    select o.assignment_id::text, o.worker_id::text, w.first_name, w.last_name,
           o.shift_id::text, o.role, o.starts_at, o.type, ct.name as type_name,
           -- The date it ran out, from records dated before the session's last day (one marked
           -- expired with a later date, or none, reads "marked as expired").
           (select max(c.expires_on)::text from credentials c
             where c.firm_id = o.firm_id and c.worker_id = o.worker_id and c.type = o.type
               and c.check_state = 'verified' and c.status in ('expired', 'valid')
               and c.expires_on < o.last_day)
             as expires_on
      from out_of_date o
      join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
      left join credential_types ct on ct.firm_id = o.firm_id and ct.code = o.type
     order by o.starts_at, w.last_name, w.first_name, o.type
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
                    and e.data ->> 'code' in ('session_has_bookings', 'places_below_booked',
                                              'change_reason_required')))
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
          : r.code === "places_below_booked" || r.code === "change_reason_required"
            ? r.code
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
  const webhook = await webhookStatus(tx);
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
    uploadList: await waitingUploads(tx, LIST_MAX),
    evidence: await loadEvidence(tx, now),
    plannerRefused: plannerRefused.items,
    plannerRefusedMore: plannerRefused.more,
    webhookFailing: webhook.status.kind === "failing" ? { since: webhook.status.since } : null,
  };
}

// Needs attention's items, for the menu's count (Phase 20; the bell's before): how many items it
// holds (null for anyone without the dashboard; a null count when it couldn't be read: the menu
// then shows no number). The layout adds the enquiries that need a person (attentionCount).
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

// Needs attention on its own page (Phase 18; the bell opens it), for an admin or resourcer, or
// null (anyone else, or logged out): its items, or that they couldn't be read.
// Phase 20: with the enquiries that need a person (they count here too) and the urgent places
// ("Also needs you"), so the page's count and the dashboard's add up.
export async function officeNeedsAttention(ctx: OfficeContext): Promise<{
  timeZone: string;
  today: string;
  needs: Part<NeedsAttention>;
  needPerson: Part<number>;
  urgent: UrgentCount;
} | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return null;
    const { timeZone } = await firmFacts(tx);
    return {
      timeZone,
      today: localDateOf(now, timeZone),
      needs: await part(tx, "needs", (sp) => loadNeedsAttention(sp, now, timeZone)),
      needPerson: await part(tx, "need-person", (sp) => needPersonCount(sp, now)),
      urgent: await part(tx, "urgent-count", (sp) => urgentCount(sp, now)),
    };
  });
}
