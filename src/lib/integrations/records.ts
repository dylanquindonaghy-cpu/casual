import { sql, type SQL } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { FIRM_CHANGE_REASONS, type FirmChangeReason } from "../roster/firm-reasons";
import { CANCELLATIONS_PAGE, encodeCursor, type CancellationsQuery } from "./schemas";

// What the planner reads about sessions and bookings (docs/office-v2.md 5.3.2 and 5.3.3): GET
// /api/v1/sessions/{ref}, GET /api/v1/cancellations, and the webhooks' `data` (12J.2 builds them
// here too, from the rows, when each is sent). Inside the firm's transaction, so row-level
// security keeps every row the key's firm's own.
//
// Never in a record: a mobile, an email address, a casual's postcode or travel data, health, or
// anything typed by a person about a booking (the cancel reason, an override reason, a request's
// note): a casual's reason is only ever "casual_own_reason" ("I'm unwell" is health data: 6.3),
// the office's and the planner's their fixed code, the rota sheet's "sheet_change". Names and
// staff refs are the only personal data, and after an erasure the casual is null with
// "erased": true. Times are UTC ("…Z").

export const iso = (d: Date): string => d.toISOString().replace(".000Z", "Z");

export interface SessionRecord {
  id: string;
  ref: string | null; // the planner's own ref (API sessions only)
  source: "native" | "sheets" | "csv" | "api";
  event: { id: string; ref: string | null; name: string };
  site: { name: string; postcode: string | null } | null;
  role: string;
  starts_at: string;
  ends_at: string;
  status: "draft" | "open" | "filled" | "cancelled";
  places: number;
  booked: number;
  pay_rate_pence: number | null;
  post: string | null;
  meeting_point: string | null;
  uniform: string | null;
  requirements: string[];
}

export type StrikeRecord =
  | { status: "issued" | "none" | "withdrawn"; live_strikes: number }
  | {
      status: "exempt";
      exempt_reason: "booked_by_office" | "rules_override" | "office_changed_it";
      live_strikes: number;
    };

export interface BookingRecord {
  id: string;
  ref: string; // the booking's reference, as the office sees it ("B71E0C42")
  status: "booked" | "cancelled" | "worked" | "no_show";
  casual: { id: string; staff_ref: string | null; first_name: string; last_name: string } | null;
  erased?: true;
  booked_at: string | null;
  booked_by: "casual" | "office" | "sheet";
  cancellation?: {
    at: string;
    by: "casual" | "office" | "planner" | "sheet";
    via: "app" | "office" | "sheet" | "import" | "api" | null;
    notice_hours: number;
    reason_code: string;
    strike: StrikeRecord;
  };
}

export interface CancellationRecord {
  session: SessionRecord;
  booking: BookingRecord;
}

type SessionRow = {
  id: string;
  external_ref: string | null;
  source: SessionRecord["source"];
  role: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: SessionRecord["status"];
  headcount: number;
  pay_rate_pence: number | null;
  post: string | null;
  meeting_point: string | null;
  uniform: string | null;
  instructions: string | null;
  required_credentials: string[] | null;
  event_id: string;
  event_source: SessionRecord["source"];
  event_ref: string | null;
  event_name: string;
  site_name: string | null;
  site_postcode: string | null;
  booked: number;
};

async function sessionRows(tx: FirmTx, where: SQL): Promise<SessionRow[]> {
  const { rows } = await tx.execute<SessionRow>(sql`
    select s.id::text as id, s.external_ref, s.source, s.role, s.starts_at, s.ends_at, s.status,
           s.headcount, s.pay_rate_pence, s.post, s.meeting_point, s.uniform, s.instructions,
           s.required_credentials, ev.id::text as event_id, ev.source as event_source,
           ev.planner_ref as event_ref, ev.name as event_name,
           si.name as site_name, si.postcode as site_postcode,
           (select count(*)::int from assignments b
             where b.firm_id = s.firm_id and b.shift_id = s.id and b.worker_id is not null
               and b.status not in ('cancelled_worker', 'cancelled_firm')) as booked
      from shifts s
      join shift_events ev on ev.firm_id = s.firm_id and ev.id = s.event_id
      left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
     where ${where}
  `);
  return rows;
}

const sessionRecord = (r: SessionRow): SessionRecord => ({
  id: r.id,
  ref: r.source === "api" ? r.external_ref : null,
  source: r.source,
  // An automatic event's key ("auto:…", whichever source made it) is ShiftDesk's own: only an
  // event the planner named has a ref.
  event: {
    id: r.event_id,
    ref: r.event_source === "api" && !r.event_ref?.startsWith("auto:") ? r.event_ref : null,
    name: r.event_name,
  },
  site: r.site_name === null ? null : { name: r.site_name, postcode: r.site_postcode },
  role: r.role,
  starts_at: iso(new Date(r.starts_at)),
  ends_at: iso(new Date(r.ends_at)),
  status: r.status,
  places: Number(r.headcount),
  booked: Number(r.booked),
  pay_rate_pence: r.pay_rate_pence === null ? null : Number(r.pay_rate_pence),
  post: r.post,
  meeting_point: r.meeting_point,
  uniform: r.uniform,
  requirements: [...(r.required_credentials ?? [])].sort(),
});

type BookingRow = {
  id: string;
  shift_id: string;
  status: "confirmed" | "cancelled_worker" | "cancelled_firm" | "completed" | "no_show";
  confirmed_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancelled_key: string | null;
  cancel_reason: string | null;
  notice_hours: number | null;
  cancel_via: NonNullable<BookingRecord["cancellation"]>["via"];
  worker_id: string;
  staff_ref: string | null;
  first_name: string;
  last_name: string;
  erased: boolean;
  assigned_by: string | null;
  assigned_source: string | null;
  strike_code: string | null;
  strike_status: "live" | "withdrawn" | null;
  live_strikes: number;
};

// Bookings only: a row with a casual that was booked (confirmed, then maybe cancelled, worked or
// a no-show). An offer still out isn't a booking.
const BOOKED = sql`a.worker_id is not null
  and a.status in ('confirmed', 'cancelled_worker', 'cancelled_firm', 'completed', 'no_show')`;

async function bookingRows(
  tx: FirmTx,
  o: { where: SQL; order: SQL; limit?: number; now: Date },
): Promise<BookingRow[]> {
  const { rows } = await tx.execute<BookingRow>(sql`
    select a.id::text as id, a.shift_id::text as shift_id, a.status, a.confirmed_at,
           a.cancelled_at,
           to_char(a.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             as cancelled_key,
           a.cancel_reason, a.notice_hours::float8 as notice_hours, a.cancel_via,
           w.id::text as worker_id, w.external_ref as staff_ref, w.first_name, w.last_name,
           w.erased_at is not null as erased,
           be.by as assigned_by, be.source as assigned_source,
           ce.strike as strike_code, st.status as strike_status,
           (select count(*)::int from strikes ls
             where ls.firm_id = a.firm_id and ls.worker_id = a.worker_id
               and ls.status = 'live' and ls.expires_at > ${o.now}) as live_strikes
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
      left join lateral (select e.data ->> 'by' as by, e.data ->> 'source' as source
                           from events e
                          where e.firm_id = a.firm_id and e.entity_id = a.id
                            and e.action = 'shift.assigned'
                          order by e.id desc limit 1) be on true
      left join lateral (select e.data ->> 'strike' as strike
                           from events e
                          where e.firm_id = a.firm_id and e.entity_id = a.id
                            and e.action = 'shift.cancelled'
                          order by e.id desc limit 1) ce on true
      left join strikes st on st.firm_id = a.firm_id and st.assignment_id = a.id
     where ${BOOKED} and ${o.where}
     order by ${o.order}
     ${o.limit === undefined ? sql`` : sql`limit ${o.limit}`}
  `);
  return rows;
}

// The office's fixed words back to their code; anything else the firm wrote is "other".
const REASON_CODES = new Map<string, FirmChangeReason>(
  (Object.entries(FIRM_CHANGE_REASONS) as [FirmChangeReason, string][]).map(([code, words]) => [
    words,
    code,
  ]),
);

function cancelledBy(r: BookingRow): NonNullable<BookingRecord["cancellation"]>["by"] {
  if (r.status === "cancelled_worker") return "casual";
  if (r.cancel_via === "sheet") return "sheet";
  if (r.cancel_via === "api") return "planner";
  return "office";
}

function reasonCode(r: BookingRow): string {
  if (r.status === "cancelled_worker") return "casual_own_reason";
  if (r.cancel_via === "sheet") return "sheet_change";
  return REASON_CODES.get(r.cancel_reason ?? "") ?? "other";
}

// The strike result recorded with the cancellation (src/lib/strikes/decide.ts), and the strike
// row's own status when one was issued. Review flags and withdrawal reasons never leave ShiftDesk.
function strikeRecord(r: BookingRow): StrikeRecord {
  const live = Number(r.live_strikes);
  if (r.strike_status === "withdrawn") return { status: "withdrawn", live_strikes: live };
  if (r.strike_status === "live" || r.strike_code === "issued") {
    return { status: "issued", live_strikes: live };
  }
  switch (r.strike_code) {
    case "booked_by_office":
    case "rules_override":
      return { status: "exempt", exempt_reason: r.strike_code, live_strikes: live };
    case "changed_after_booking":
      return { status: "exempt", exempt_reason: "office_changed_it", live_strikes: live };
    default:
      return { status: "none", live_strikes: live };
  }
}

const BOOKING_STATUS: Record<BookingRow["status"], BookingRecord["status"]> = {
  confirmed: "booked",
  cancelled_worker: "cancelled",
  cancelled_firm: "cancelled",
  completed: "worked",
  no_show: "no_show",
};

function bookingRecord(r: BookingRow): BookingRecord {
  const cancelled = r.status === "cancelled_worker" || r.status === "cancelled_firm";
  return {
    id: r.id,
    ref: r.id.slice(0, 8).toUpperCase(),
    status: BOOKING_STATUS[r.status],
    casual: r.erased
      ? null
      : {
          id: r.worker_id,
          staff_ref: r.staff_ref,
          first_name: r.first_name,
          last_name: r.last_name,
        },
    ...(r.erased ? { erased: true as const } : {}),
    booked_at: r.confirmed_at === null ? null : iso(new Date(r.confirmed_at)),
    // The booking's own entry: the casual took it (an offer they accepted included), the rota
    // sheet named them, or the office placed them (also when there's no entry: a strike needs
    // proof that the casual took it, src/lib/strikes/issue.ts).
    booked_by:
      r.assigned_by === "worker" ? "casual" : r.assigned_source === "sheets" ? "sheet" : "office",
    ...(cancelled && r.cancelled_at !== null
      ? {
          cancellation: {
            at: iso(new Date(r.cancelled_at)),
            by: cancelledBy(r),
            via: r.cancel_via,
            notice_hours: Number(r.notice_hours ?? 0),
            reason_code: reasonCode(r),
            strike: strikeRecord(r),
          },
        }
      : {}),
  };
}

export type HeldSession = SessionRecord & { instructions: string | null };

// One session as ShiftDesk holds it, with the instructions the planner sent (for booked casuals
// only): what a PUT answers with. Null if there's none.
export async function sessionAsHeld(tx: FirmTx, shiftId: string): Promise<HeldSession | null> {
  const [row] = await sessionRows(tx, sql`s.id = ${shiftId}`);
  return row ? { ...sessionRecord(row), instructions: row.instructions } : null;
}

// The session as held, with every booking, live and cancelled, oldest first (then by place).
export async function sessionWithBookings(
  tx: FirmTx,
  shiftId: string,
  now: Date,
): Promise<{ session: HeldSession; bookings: BookingRecord[] } | null> {
  const session = await sessionAsHeld(tx, shiftId);
  if (!session) return null;
  const bookings = await bookingRows(tx, {
    where: sql`a.shift_id = ${shiftId}`,
    order: sql`coalesce(a.confirmed_at, a.cancelled_at), a.slot, a.id`,
    now,
  });
  return { session, bookings: bookings.map(bookingRecord) };
}

// One booking with its session, as a webhook's `data` carries it (12J.2 builds each body from the
// rows when it's sent): booked or cancelled. Null if there's no such booking.
export async function bookingWithSession(
  tx: FirmTx,
  assignmentId: string,
  now: Date,
): Promise<CancellationRecord | null> {
  const [row] = await bookingRows(tx, {
    where: sql`a.id = ${assignmentId}`,
    order: sql`a.id`,
    now,
  });
  if (!row) return null;
  const [session] = await sessionRows(tx, sql`s.id = ${row.shift_id}`);
  return session ? { session: sessionRecord(session), booking: bookingRecord(row) } : null;
}

// Cancellations oldest first, by (cancellation time, booking id): from a time (`since`, that time
// included) or after a cursor, CANCELLATIONS_PAGE at most. next_cursor is the last record's place
// when the page is full, null once caught up. One whole-session cancellation stamps every booking
// with the same time, so the booking id keeps the order exact and the cursor neither repeats nor
// skips one.
export async function cancellationPage(
  tx: FirmTx,
  query: CancellationsQuery,
  now: Date,
): Promise<{ records: CancellationRecord[]; next_cursor: string | null }> {
  const after =
    query.from === "since"
      ? sql`a.cancelled_at >= ${query.since}`
      : sql`(a.cancelled_at, a.id) > (${query.cursor.t}::timestamptz, ${query.cursor.b}::uuid)`;
  const rows = await bookingRows(tx, {
    where: sql`a.status in ('cancelled_worker', 'cancelled_firm') and ${after}`,
    order: sql`a.cancelled_at, a.id`,
    limit: CANCELLATIONS_PAGE,
    now,
  });
  const shiftIds = [...new Set(rows.map((r) => r.shift_id))];
  const sessions = new Map(
    shiftIds.length === 0
      ? []
      : (
          await sessionRows(
            tx,
            sql`s.id in (${sql.join(
              shiftIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
          )
        ).map((r) => [r.id, sessionRecord(r)] as const),
  );
  const records: CancellationRecord[] = [];
  for (const r of rows) {
    const session = sessions.get(r.shift_id);
    if (session) records.push({ session, booking: bookingRecord(r) });
  }
  const last = rows.at(-1);
  return {
    records,
    next_cursor:
      rows.length === CANCELLATIONS_PAGE && last?.cancelled_key
        ? encodeCursor({ t: last.cancelled_key, b: last.id })
        : null,
  };
}
