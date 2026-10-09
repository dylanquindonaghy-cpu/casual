import { eq, inArray, sql } from "drizzle-orm";
import type { AuthContext } from "../auth/link-login";
import { authParts } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { credentialRules, credentialTypes, firms, type CancelVia } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import {
  evidenceStuckSql,
  lastEvidenceCodeSql,
  NOTHING_SENT_CODES,
  resendEvidence,
  type ResendEvidenceResult,
} from "../strikes/evidence-queue";
import type { StrikeCode } from "../strikes/decide";
import { liveStrikeCount } from "../strikes/issue";
import { strikeSettings } from "../strikes/settings";
import { addDays, localDateOf, mondayOf, zonedToUtc } from "../time/zoned";
import { isThenPlace, type CancellationRow, type CancellationView } from "./cancellations-copy";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// Cancellation records (docs/office-v2.md 3.4; docs/screens.md `/office/cancellations`; 12C.3), for
// admins and resourcers (checked here as well as on the page). Every cancelled booking, by the
// casual or by the firm, newest first, with this week's counts (the firm's own Monday to Sunday),
// and one record by its reference. Nothing here approves or changes anything: a cancellation is
// final when it's made (src/lib/roster/cancel.ts).
//
// "Then" comes from what happened next, read without comparing clocks (the app's and the
// database's can differ). What became of the place is what the cancellation recorded in its
// shift.cancelled entry (`place`: src/lib/roster/native.ts placeAfterCancel), never guessed from
// slots later (bookings move between slots); who took it next is whoever booked the row that
// reopened it (`reopenedId`), at that booking's own confirmed time. "Marked urgent" and "offered
// to" are log entries after the cancellation's own (event ids only grow) and before the session's
// next cancellation in a later transaction, if any: offers are for a session, not a place, so a
// later dropout's offers go on its own record (a rota-sheet sync's removals, in one transaction,
// share theirs). "Offered to" counts the casuals sent an offer for the session in that window.
//
// A download (the CSV, a record's PDF) is logged export.downloaded with ids and counts only.

export const CANCELLATIONS_PAGE_ROWS = 100;
export const CANCELLATIONS_CSV_ROWS = 20_000;

type Row = {
  id: string;
  worker_id: string;
  first_name: string;
  last_name: string;
  external_ref: string | null;
  status: string;
  confirmed_at: string | Date | null;
  cancelled_at: string | Date;
  cancel_reason: string;
  notice_hours: number;
  cancel_via: CancelVia | null;
  strike_warning_version: string | null;
  strike_warning_shown_at: string | Date | null;
  role: string;
  starts_at: string | Date;
  ends_at: string | Date;
  post: string | null;
  pay_rate_pence: number | null;
  meeting_point: string | null;
  uniform: string | null;
  required_credentials: string[];
  site_name: string | null;
  site_postcode: string | null;
  event_name: string | null;
  office_name: string | null;
  strike_code: string | null;
  strike_status: "live" | "withdrawn" | null;
  strike_expires_at: string | Date | null;
  review_needed: boolean | null;
  evidence_email_status: string | null;
  evidence_email_to: string | null;
  evidence_email_sent_at: string | Date | null;
  evidence_stuck: boolean;
  evidence_code: string | null;
  withdrawn_at: string | Date | null;
  withdrawn_reason: string | null;
  withdrawn_by_name: string | null;
  reviewed_at: string | Date | null;
  reviewed_by_name: string | null;
  place: string | null;
  marked_urgent: boolean;
  offered_to: number;
  replacement_first: string | null;
  replacement_last: string | null;
  replacement_at: string | Date | null;
};

const date = (v: string | Date) => new Date(v);
const dateOrNull = (v: string | Date | null) => (v ? new Date(v) : null);
const STRIKE_CODES = new Set<string>([
  "issued",
  "by_firm",
  "enough_notice",
  "booked_by_office",
  "rules_override",
  "changed_after_booking",
]);

function viewFilter(view: CancellationView, threshold: number) {
  if (view === "office") return sql`and a.status = 'cancelled_firm'`;
  if (view === "under") return sql`and a.notice_hours < ${threshold}`;
  return sql``;
}

// The number of cancelled bookings in a view.
async function countRows(tx: FirmTx, view: CancellationView, threshold: number): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from assignments a
     where a.status in ('cancelled_worker', 'cancelled_firm') ${viewFilter(view, threshold)}
  `);
  return Number(rows[0]?.n ?? 0);
}

// The cancelled bookings in a view, newest first (or those with a reference, or one by its id).
// A withdrawn strike's reason (the office's words) only for a record, never for a list or the CSV.
async function loadRows(
  tx: FirmTx,
  o: {
    view: CancellationView;
    threshold: number;
    limit: number;
    ref?: string; // the booking's first 8 characters, upper case
    id?: string; // the booking's full id
  },
): Promise<Row[]> {
  const { rows } = await tx.execute<Row>(sql`
    select a.id::text, a.worker_id::text, w.first_name, w.last_name, w.external_ref, a.status,
           a.confirmed_at, a.cancelled_at, a.cancel_reason, a.notice_hours::float as notice_hours,
           a.cancel_via, a.strike_warning_version, a.strike_warning_shown_at,
           s.role, s.starts_at, s.ends_at, s.post, s.pay_rate_pence,
           s.meeting_point, s.uniform, s.required_credentials,
           si.name as site_name, si.postcode as site_postcode, ev.name as event_name,
           ou.name as office_name, ce.data ->> 'strike' as strike_code,
           st.status as strike_status, st.expires_at as strike_expires_at, st.review_needed,
           st.withdrawn_at, ${o.id || o.ref ? sql`st.withdrawn_reason` : sql`null::text`}
             as withdrawn_reason, wo.name as withdrawn_by_name,
           st.reviewed_at, ro.name as reviewed_by_name,
           st.evidence_email_status, st.evidence_email_to, st.evidence_email_sent_at,
           coalesce(${evidenceStuckSql("st")}, false) as evidence_stuck,
           ${lastEvidenceCodeSql("st")} as evidence_code,
           ce.data ->> 'place' as place,
           coalesce(ce.id is not null and exists (
             select 1 from events u
              where u.firm_id = a.firm_id and u.entity_id = a.shift_id
                and u.id > ce.id and (nc.id is null or u.id < nc.id)
                and u.action = 'shift.marked_urgent' and u.data ->> 'cause' = 'dropout'), false)
             as marked_urgent,
           coalesce((select count(distinct o.worker_id)::int
                       from offers o
                       join events v on v.firm_id = o.firm_id and v.entity_id = o.id
                                    and v.action = 'offer.sent'
                      where ce.id is not null and o.firm_id = a.firm_id and o.shift_id = a.shift_id
                        and v.id > ce.id and (nc.id is null or v.id < nc.id)), 0) as offered_to,
           rp.first_name as replacement_first, rp.last_name as replacement_last,
           rp.confirmed_at as replacement_at
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
      left join shift_events ev on ev.firm_id = s.firm_id and ev.id = s.event_id
      left join lateral (select e.id, e.created_at, e.actor_type, e.actor_id, e.data from events e
                          where e.firm_id = a.firm_id and e.entity_id = a.id
                            and e.action = 'shift.cancelled'
                          order by e.id desc limit 1) ce on true
      left join lateral (select min(n.id) as id
                           from assignments b
                           join events n on n.firm_id = b.firm_id and n.entity_id = b.id
                                        and n.action = 'shift.cancelled'
                          where b.firm_id = a.firm_id and b.shift_id = a.shift_id
                            and b.id <> a.id and n.id > ce.id
                            and n.created_at <> ce.created_at) nc on true
      left join office_users ou
        on ou.firm_id = a.firm_id and ce.actor_type = 'office' and ou.id = ce.actor_id
      left join strikes st on st.firm_id = a.firm_id and st.assignment_id = a.id
      left join office_users wo on wo.firm_id = st.firm_id and wo.id = st.withdrawn_by
      left join office_users ro on ro.firm_id = st.firm_id and ro.id = st.reviewed_by
      left join lateral (select w2.first_name, w2.last_name, r.confirmed_at
                           from assignments r
                           join workers w2 on w2.firm_id = r.firm_id and w2.id = r.worker_id
                          where r.firm_id = a.firm_id and r.shift_id = a.shift_id
                            and ce.data ->> 'place' = 'reopened'
                            and r.id::text = ce.data ->> 'reopenedId'
                            and r.confirmed_at is not null) rp on true
     where a.status in ('cancelled_worker', 'cancelled_firm')
       ${
         o.id
           ? sql`and a.id = ${o.id}::uuid`
           : o.ref
             ? sql`and upper(left(a.id::text, 8)) = ${o.ref}`
             : viewFilter(o.view, o.threshold)
       }
     order by a.cancelled_at desc, a.id
     limit ${o.limit}
  `);
  return rows;
}

async function requirementNames(tx: FirmTx, rows: Row[]) {
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
  return (r: Row) =>
    [...new Set([...(byRole.get(r.role) ?? []), ...(r.required_credentials ?? [])])].map(
      (code) => ({ code, name: names.get(code) ?? code }),
    );
}

function toRow(r: Row, requirements: CancellationRow["requirements"]): CancellationRow {
  const by: CancellationRow["by"] =
    r.status === "cancelled_worker" ? "casual" : r.cancel_via === "sheet" ? "sheet" : "office";
  return {
    assignmentId: r.id,
    ref: r.id.slice(0, 8).toUpperCase(),
    workerId: r.worker_id,
    casual: `${r.first_name} ${r.last_name}`,
    staffId: r.external_ref,
    eventName: r.event_name,
    role: r.role,
    startsAt: date(r.starts_at),
    endsAt: date(r.ends_at),
    siteName: r.site_name,
    sitePostcode: r.site_postcode,
    post: r.post,
    payRatePence: r.pay_rate_pence,
    meetingPoint: r.meeting_point,
    uniform: r.uniform,
    requirements,
    bookedAt: dateOrNull(r.confirmed_at),
    cancelledAt: date(r.cancelled_at),
    by,
    via: r.cancel_via,
    officeName: r.office_name,
    reason: r.cancel_reason,
    noticeHours: Number(r.notice_hours),
    strikeCode:
      r.strike_code && STRIKE_CODES.has(r.strike_code) ? (r.strike_code as StrikeCode) : null,
    strike:
      r.strike_status && r.strike_expires_at
        ? {
            status: r.strike_status,
            expiresAt: date(r.strike_expires_at),
            reviewNeeded: Boolean(r.review_needed),
            withdrawn: r.withdrawn_at
              ? {
                  by: r.withdrawn_by_name,
                  at: date(r.withdrawn_at),
                  reason: r.withdrawn_reason,
                }
              : null,
            reviewed: r.reviewed_at ? { by: r.reviewed_by_name, at: date(r.reviewed_at) } : null,
            evidence: {
              status: r.evidence_email_status,
              to: r.evidence_email_to,
              sentAt: dateOrNull(r.evidence_email_sent_at),
              stuck: r.evidence_stuck,
              nothingSent: r.evidence_code !== null && NOTHING_SENT_CODES.includes(r.evidence_code),
            },
          }
        : null,
    warning:
      r.strike_warning_version && r.strike_warning_shown_at
        ? { version: r.strike_warning_version, shownAt: date(r.strike_warning_shown_at) }
        : null,
    then: {
      place: isThenPlace(r.place) ? r.place : null,
      markedUrgent: r.marked_urgent,
      offeredTo: Number(r.offered_to),
      replacement:
        r.replacement_first !== null && r.replacement_at
          ? {
              name: `${r.replacement_first} ${r.replacement_last ?? ""}`.trim(),
              at: date(r.replacement_at),
            }
          : null,
    },
  };
}

async function firmFacts(tx: FirmTx) {
  const [firm] = await tx
    .select({ name: firms.name, timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return {
    name: firm?.name ?? "",
    timezone: firm?.timezone ?? "Europe/London",
    threshold: strikeSettings(firm?.settings ?? {}).noticeHours,
  };
}

export interface CancellationList {
  firmName: string;
  timeZone: string;
  threshold: number;
  view: CancellationView;
  week: { byCasuals: number; byOffice: number; strikes: number };
  rows: CancellationRow[];
  total: number; // in the view, beyond the rows shown
}

// The cancelled bookings in a view, newest first (at most `limit`), with the firm's facts.
// `allOrNothing` (the CSV): none loaded when the view holds more than `limit`.
export async function loadCancellations(
  tx: FirmTx,
  o: { view: CancellationView; now: Date; limit: number; allOrNothing?: boolean },
): Promise<CancellationList> {
  const firm = await firmFacts(tx);
  const monday = mondayOf(localDateOf(o.now, firm.timezone));
  const at = (day: string) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, firm.timezone);
  };
  const from = at(monday);
  const to = at(addDays(monday, 7));
  const { rows: counts } = await tx.execute<{ casuals: number; office: number; strikes: number }>(
    sql`select
          (select count(*)::int from assignments a where a.status = 'cancelled_worker'
             and a.cancelled_at >= ${from} and a.cancelled_at < ${to}) as casuals,
          (select count(*)::int from assignments a where a.status = 'cancelled_firm'
             and a.cancelled_at >= ${from} and a.cancelled_at < ${to}) as office,
          (select count(*)::int from strikes s
            where s.issued_at >= ${from} and s.issued_at < ${to}) as strikes`,
  );
  const total = await countRows(tx, o.view, firm.threshold);
  const rows =
    o.allOrNothing && total > o.limit
      ? []
      : await loadRows(tx, { view: o.view, threshold: firm.threshold, limit: o.limit });
  const requirementsOf = await requirementNames(tx, rows);
  return {
    firmName: firm.name,
    timeZone: firm.timezone,
    threshold: firm.threshold,
    view: o.view,
    week: {
      byCasuals: Number(counts[0]?.casuals ?? 0),
      byOffice: Number(counts[0]?.office ?? 0),
      strikes: Number(counts[0]?.strikes ?? 0),
    },
    rows: rows.map((r) => toRow(r, requirementsOf(r))),
    total,
  };
}

export interface CancellationRecord {
  firmName: string;
  timeZone: string;
  threshold: number;
  row: CancellationRow;
  liveStrikes: number; // the casual's live strikes now
}

// A reference that more than one cancelled booking shares: the page lists them to choose from.
export interface SharedReference {
  ref: string;
  timeZone: string;
  choices: CancellationRow[];
}

export type CancellationLookup =
  { status: "found"; record: CancellationRecord } | { status: "several"; shared: SharedReference };

const REF = /^[0-9A-F]{8}$/;
const BOOKING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CHOICES = 20;

// One record by its reference (the booking's first 8 characters, any case) or by the booking's full
// id. A reference is short: the more cancellations a firm has, the likelier two share one (about 1
// in 90 by 10,000), so a shared reference lists its bookings to choose from (each by its full id)
// rather than picking one.
export async function loadCancellationRecord(
  tx: FirmTx,
  refOrId: string,
  now: Date,
): Promise<CancellationLookup | null> {
  const id = refOrId.toLowerCase();
  const ref = refOrId.toUpperCase();
  const by = BOOKING_ID.test(id) ? { id } : REF.test(ref) ? { ref } : null;
  if (!by) return null;
  const firm = await firmFacts(tx);
  const rows = await loadRows(tx, {
    view: "all",
    threshold: firm.threshold,
    limit: MAX_CHOICES,
    ...by,
  });
  const [row] = rows;
  if (!row) return null;
  if (rows.length > 1) {
    const requirementsOf = await requirementNames(tx, rows);
    return {
      status: "several",
      shared: {
        ref,
        timeZone: firm.timezone,
        choices: rows.map((r) => toRow(r, requirementsOf(r))),
      },
    };
  }
  const requirementsOf = await requirementNames(tx, [row]);
  return {
    status: "found",
    record: {
      firmName: firm.name,
      timeZone: firm.timezone,
      threshold: firm.threshold,
      row: toRow(row, requirementsOf(row)),
      liveStrikes: await liveStrikeCount(tx, row.worker_id, now),
    },
  };
}

// The office user may see cancellations: an active admin or resourcer (the page and every route).
async function mayView(ctx: AuthContext, token: string) {
  const me = await currentOfficeUser(ctx, token);
  return me && canAccess(me.officeUser.role, "cancellations") ? me : null;
}

export async function officeCancellations(
  ctx: AuthContext,
  token: string,
  view: CancellationView,
  o: { limit: number; allOrNothing?: boolean } = { limit: CANCELLATIONS_PAGE_ROWS },
): Promise<CancellationList | null> {
  if (!(await mayView(ctx, token))) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadCancellations(tx, { view, now, ...o }));
}

export async function officeCancellationRecord(
  ctx: AuthContext,
  token: string,
  refOrId: string,
): Promise<CancellationLookup | null> {
  if (!(await mayView(ctx, token))) return null;
  const { run, now } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadCancellationRecord(tx, refOrId, now));
}

// A download, logged before it's handed over (ids and counts only).
export async function logDownload(
  ctx: AuthContext,
  token: string,
  what:
    | { kind: "cancellations_csv"; view: CancellationView; rows: number }
    | { kind: "cancellation_pdf"; assignmentId: string },
): Promise<boolean> {
  const me = await mayView(ctx, token);
  if (!me) return false;
  const { run } = authParts(ctx);
  await run(ctx.firm.id, (tx) =>
    recordEvent(tx, {
      actorType: "office",
      actorId: me.officeUser.id,
      action: "export.downloaded",
      entityType: what.kind === "cancellation_pdf" ? "assignment" : "firm",
      entityId: what.kind === "cancellation_pdf" ? what.assignmentId : ctx.firm.id,
      data: what,
    }),
  );
  return true;
}

// "Resend evidence" on a cancellation's record (12C.4): an active admin or resourcer, checked again
// inside the firm's transaction; only after the evidence email failed (src/lib/strikes/
// evidence-queue.ts). Logged strike.evidence_resend.
export async function resendEvidenceAsOffice(
  ctx: OfficeContext,
  assignmentId: string,
): Promise<ResendEvidenceResult | { status: "not_allowed" }> {
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "cancellations"))) {
      return { status: "not_allowed" as const };
    }
    return resendEvidence(tx, { assignmentId, officeUserId: ctx.officeUserId });
  });
}
