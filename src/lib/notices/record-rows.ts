import { sql, type SQL } from "drizzle-orm";

// The notice record's rows (golden rule 12; docs/compliance.md "Employment Rights Act"): one row per
// offer, booking, move, shortening and cancellation in the append-only action log, with who started
// it and the notice the worker had. Shared by the office's notice report
// (src/lib/office/notice-report.ts, which adds the worker's name, the short-notice flag, who asked
// and the office's own reasons) and the casual's own shift record (src/lib/portal/my-record.ts,
// Phase 28.4, which keeps only what was logged and is hers). Pure, except the SQL pieces below,
// which both queries use so they count the notice the same way.
//
//   offered   offer.sent        (an offer wave, or the office)
//   booked    shift.assigned    (the worker, the office, the rota sheet or the firm's planner)
//   moved     shift.moved       (the office, the rota sheet or the planner)
//   shortened shift.curtailed   (the office, the rota sheet or the planner)
//   cancelled shift.cancelled   (the worker, the office, the rota sheet or the planner)

export const RECORD_ACTIONS = [
  "offer.sent",
  "shift.assigned",
  "shift.moved",
  "shift.curtailed",
  "shift.cancelled",
] as const;

export type RowKind = "offered" | "booked" | "moved" | "shortened" | "cancelled";
export type Initiator = "worker" | "office" | "rota_sheet" | "offer_wave" | "firm";

const KIND_OF: Record<string, RowKind> = {
  "offer.sent": "offered",
  "shift.assigned": "booked",
  "shift.moved": "moved",
  "shift.curtailed": "shortened",
  "shift.cancelled": "cancelled",
};

// Who started it, from the event: the worker, the office, the rota sheet (the Google Sheets sync,
// the system on the firm's behalf), or an offer wave.
export function initiatorOf(
  action: string,
  actorType: string,
  data: Record<string, unknown>,
): Initiator {
  if (action === "offer.sent") return data.offeredBy ? "office" : "offer_wave";
  if (data.by === "worker") return "worker";
  if (data.source === "sheets") return "rota_sheet";
  return actorType === "office" ? "office" : "firm";
}

const isoOf = (v: unknown): Date | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;

// --- SQL, for a query over the action log `e` joined to the session `s` the entry is about -------

// The notice the entry itself logged, in hours (null when it logged none).
export const recordedNoticeSql = (): SQL =>
  sql`case when e.data ->> 'noticeHours' ~ '^-?[0-9]+(\\.[0-9]+)?$'
           then (e.data ->> 'noticeHours')::numeric end`;
// The notice in hours: the entry's own figure, or for an older offer (logged before offers recorded
// it), worked out from the session's start as it is now.
export const noticeSql = (): SQL =>
  sql`coalesce(${recordedNoticeSql()}, case when e.action = 'offer.sent' and s.starts_at is not null
      then round((extract(epoch from s.starts_at - e.created_at) / 3600)::numeric, 2) end)`;
// True when noticeSql() worked the figure out rather than reading it from the entry.
export const fromCurrentStartSql = (): SQL =>
  sql`(${recordedNoticeSql()}) is null and e.action = 'offer.sent' and s.starts_at is not null`;

export const UUID_TEXT = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
// The session the entry names, or (an older rota-sheet move that named none) that of the booking
// it's about, joined as `a`.
export const entryShiftIdSql = (): SQL =>
  sql`coalesce(case when e.data ->> 'shiftId' ~ ${UUID_TEXT} then (e.data ->> 'shiftId')::uuid end,
               a.shift_id)`;
// Who asked for a cancellation (P3.4): its own log entry, else its booking's record (`a`; every one
// since migration 0053); one with neither (none should be) is not known. Null for other rows.
export const askedBySql = (): SQL =>
  sql`case when e.action = 'shift.cancelled'
           then coalesce(case when e.data ->> 'askedBy' in ('casual', 'firm', 'client', 'unknown')
                              then e.data ->> 'askedBy' end,
                         a.cancel_asked_by, 'unknown') end`;

// What each row's query returns (numerics come back from Postgres as strings). A type, not an
// interface, so a query's own row can add to it and still be a plain record for tx.execute().
export type RecordQueryRow = {
  id: string | number;
  action: string;
  actor_type: string;
  data: Record<string, unknown>;
  created_at: string | Date;
  notice: string | number | null; // noticeSql()
  from_current: boolean; // fromCurrentStartSql()
  shift_id: string | null;
  role: string | null;
  starts_at: string | Date | null;
  site_name: string | null;
};

export interface RecordShift {
  id: string;
  role: string;
  site: string | null;
  startsAt: Date;
}

// A move's or shortening's times before and after, and whether the site changed.
export interface RecordMove {
  fromStart: Date;
  fromEnd: Date;
  toStart: Date;
  toEnd: Date;
  siteChanged: boolean;
}

export interface RecordRow {
  eventId: number;
  at: Date;
  kind: RowKind;
  initiator: Initiator;
  shift: RecordShift | null;
  moved: RecordMove | null;
  noticeHours: number | null;
  // An older offer: noticeHours was counted from the session's start as it is now, not logged.
  noticeFromCurrentStart: boolean;
  // noticeHours is the figure the entry logged when it happened (the casual's record shows only
  // this one: "Notice not recorded" otherwise).
  noticeLogged: boolean;
  // The entry's own `reason`, on a row the firm started (its fixed change and cancellation words,
  // or the rota sheet's; a worker's typed reason is never logged). Null otherwise.
  loggedReason: string | null;
}

// One row from its query's row.
export function recordRow(r: RecordQueryRow): RecordRow {
  const hours = r.notice === null ? null : Number(r.notice);
  const noticeHours = hours !== null && Number.isFinite(hours) ? hours : null;
  const kind = KIND_OF[r.action] ?? "booked";
  const initiator = initiatorOf(r.action, r.actor_type, r.data);
  const oldStart = isoOf(r.data.oldStartsAt);
  const newStart = isoOf(r.data.newStartsAt);
  const oldEnd = isoOf(r.data.oldEndsAt);
  const newEnd = isoOf(r.data.newEndsAt);
  return {
    eventId: Number(r.id),
    at: new Date(r.created_at),
    kind,
    initiator,
    shift:
      r.shift_id && r.role && r.starts_at
        ? { id: r.shift_id, role: r.role, site: r.site_name, startsAt: new Date(r.starts_at) }
        : null,
    moved:
      (kind === "moved" || kind === "shortened") && oldStart && newStart && oldEnd && newEnd
        ? {
            fromStart: oldStart,
            fromEnd: oldEnd,
            toStart: newStart,
            toEnd: newEnd,
            siteChanged:
              "oldSiteId" in r.data &&
              "newSiteId" in r.data &&
              r.data.oldSiteId !== r.data.newSiteId,
          }
        : null,
    noticeHours,
    noticeFromCurrentStart: Boolean(r.from_current),
    noticeLogged: noticeHours !== null && !r.from_current,
    loggedReason:
      initiator !== "worker" && typeof r.data.reason === "string" ? r.data.reason : null,
  };
}
