import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { officeUsers, workers } from "../db/schema";
import { firstComeWaves, waveCap } from "../offers/waves";
import { parseAllocationSettings } from "../roster/allocation-input";
import { eventWords } from "./event-words";
import { openPlacesInWindow } from "./event-offers";
import { bookedJoin } from "./events";

// An event's page, round 8 (Phase 26.5; the spec page's "An event's page", evt-1 to evt-6): every
// place of its sessions still to come laid out by role and time (booked, with who; open; urgent),
// booked of needed per role, the open places with what each needs, how many were offered and why
// it's open (the cancellation that opened it), the event's cancellations and its history. All
// read by code from the firm's own records, inside its transaction (the event's page's own).

const CANCELLED_STATUSES = sql.raw("'cancelled_worker', 'cancelled_firm'");

// "closed": a place nobody can be booked into now (the session started, or was marked filled).
export type PlaceState = "booked" | "open" | "urgent" | "closed";

export interface StaffingPlace {
  slot: number;
  state: PlaceState;
  worker: { id: string; name: string } | null;
}

export interface StaffingSession {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  places: StaffingPlace[];
}

export interface StaffingRole {
  role: string;
  booked: number;
  needed: number;
  requirements: string[]; // the qualifications its sessions need (names), each once
  starts: Date[]; // its sessions' start times, each once, in order
}

export interface LastCancel {
  worker: string;
  at: Date;
  noticeHours: number;
  byCasual: boolean;
  strike: "live" | "withdrawn" | null;
}

export interface OpenPlace {
  shiftId: string;
  role: string;
  startsAt: Date;
  endsAt: Date;
  placesFree: number;
  urgent: boolean;
  showing: boolean; // to casuals: its own switch and its event's
  offers: number; // offers sent, any answer
  offering: boolean; // its offers are going out now (urgent, shown, its waves not stopped)
  requirements: string[];
  lastCancel: LastCancel | null; // the latest cancellation on it, while a place is open
}

export interface EventCancellation {
  assignmentId: string;
  worker: string;
  role: string;
  startsAt: Date;
  at: Date;
  noticeHours: number;
  byCasual: boolean;
  strike: "live" | "withdrawn" | null;
}

export interface EventStaffing {
  venue: { name: string; town: string | null; postcode: string | null } | null;
  sessions: StaffingSession[];
  roles: StaffingRole[];
  booked: number;
  needed: number;
  open: OpenPlace[];
  firstWave: number | null; // how many "Offer to the best …" goes to for one place (null: unknown)
  offerNow: number; // free places "Offer N open places" would offer now (inside the urgent window)
  cancellations: EventCancellation[];
  history: { at: Date; words: string }[];
}

export const STAFFING_HISTORY = 100;
export const STAFFING_CANCELLATIONS = 100;

const date = (v: string | Date) => new Date(v);

// `requirements`: each session's qualifications by name, as the event's page already read them
// (src/lib/office/events.ts: the role's, then the session's own).
export async function loadEventStaffing(
  tx: FirmTx,
  now: Date,
  eventId: string,
  requirements: ReadonlyMap<string, string[]>,
): Promise<EventStaffing> {
  const { rows: venueRows } = await tx.execute<{
    name: string;
    town: string | null;
    postcode: string | null;
  }>(sql`
    select v.name, v.town, v.postcode from shift_events e
      join sites v on v.firm_id = e.firm_id and v.id = e.site_id
     where e.id = ${eventId}::uuid
  `);
  // The sessions still to come (not cancelled, not ended), in time and role order.
  const { rows: sessionRows } = await tx.execute<{
    id: string;
    role: string;
    starts_at: string | Date;
    ends_at: string | Date;
    headcount: number;
    status: string;
    is_urgent: boolean;
    booked: number;
    showing: boolean;
    offers: number;
    stopped: boolean;
  }>(sql`
    select s.id::text as id, s.role, s.starts_at, s.ends_at, s.headcount, s.status, s.is_urgent,
           b.booked, (s.showing_to_casuals and e.showing_to_casuals) as showing,
           (select count(*)::int from offers o
             where o.firm_id = s.firm_id and o.shift_id = s.id) as offers,
           coalesce(
             (select (ev.data ->> 'wave')::int from events ev
               where ev.entity_id = s.id and ev.action = 'offer.waves_stopped'
               order by ev.id desc limit 1)
             > coalesce((select max(o.wave) from offers o where o.shift_id = s.id), 0),
             false) as stopped
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
      ${bookedJoin}
     where s.event_id = ${eventId}::uuid and s.status <> 'cancelled' and s.ends_at > ${now}
     order by s.starts_at, s.role, s.id
  `);
  const ids = sessionRows.map((r) => r.id);
  const idList = ids.length
    ? sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )
    : null;
  // Who holds each place (as the booked count counts them: a worker, not cancelled, within the
  // session's places).
  const { rows: held } = idList
    ? await tx.execute<{ shift_id: string; slot: number; worker_id: string; name: string }>(sql`
        select a.shift_id::text as shift_id, a.slot, w.id::text as worker_id,
               trim(w.first_name || ' ' || w.last_name) as name
          from assignments a
          join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
          join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
         where a.shift_id in (${idList}) and a.worker_id is not null
           and a.status not in (${CANCELLED_STATUSES}) and a.slot <= s.headcount
         order by a.slot
      `)
    : { rows: [] };
  // Each session's latest cancellation (who, when, notice, strike).
  const { rows: lastCancels } = idList
    ? await tx.execute<{
        shift_id: string;
        slot: number;
        name: string;
        cancelled_at: string | Date;
        notice_hours: string | number | null;
        status: string;
        strike: "live" | "withdrawn" | null;
      }>(sql`
        select distinct on (a.shift_id) a.shift_id::text as shift_id, a.slot,
               trim(w.first_name || ' ' || w.last_name) as name, a.cancelled_at, a.notice_hours,
               a.status,
               (select st.status from strikes st
                 where st.firm_id = a.firm_id and st.assignment_id = a.id
                 order by st.issued_at desc limit 1) as strike
          from assignments a
          join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
         where a.shift_id in (${idList}) and a.status in (${CANCELLED_STATUSES})
           and a.cancelled_at is not null
         order by a.shift_id, a.cancelled_at desc, a.id
      `)
    : { rows: [] };

  const bySession = new Map<string, Map<number, { id: string; name: string }>>();
  for (const h of held) {
    const m = bySession.get(h.shift_id) ?? new Map();
    m.set(h.slot, { id: h.worker_id, name: h.name });
    bySession.set(h.shift_id, m);
  }
  const lastBySession = new Map(lastCancels.map((c) => [c.shift_id, c]));

  const sessions: StaffingSession[] = [];
  const open: OpenPlace[] = [];
  const roles = new Map<string, StaffingRole>();
  for (const r of sessionRows) {
    const startsAt = date(r.starts_at);
    const started = startsAt.getTime() <= now.getTime();
    const free = Math.max(0, r.headcount - r.booked);
    const fillable = r.status === "open" && !started && free > 0;
    const urgent = fillable && r.is_urgent;
    const holders = bySession.get(r.id) ?? new Map<number, { id: string; name: string }>();
    // Booked first by slot, then the open places.
    const places: StaffingPlace[] = [];
    for (let slot = 1; slot <= r.headcount; slot++) {
      const w = holders.get(slot) ?? null;
      places.push({
        slot,
        state: w ? "booked" : !fillable ? "closed" : urgent ? "urgent" : "open",
        worker: w,
      });
    }
    sessions.push({ shiftId: r.id, role: r.role, startsAt, endsAt: date(r.ends_at), places });
    const role = roles.get(r.role) ?? {
      role: r.role,
      booked: 0,
      needed: 0,
      requirements: [],
      starts: [],
    };
    role.booked += Math.min(r.booked, r.headcount);
    role.needed += r.headcount;
    const needs = requirements.get(r.id) ?? [];
    for (const q of needs) if (!role.requirements.includes(q)) role.requirements.push(q);
    if (!role.starts.some((d) => d.getTime() === startsAt.getTime())) role.starts.push(startsAt);
    roles.set(r.role, role);
    if (fillable) {
      // Why it's open: its latest cancellation, only while that place is still the open one.
      const latest = lastBySession.get(r.id);
      const c = latest && !holders.has(latest.slot) ? latest : undefined;
      open.push({
        shiftId: r.id,
        role: r.role,
        startsAt,
        endsAt: date(r.ends_at),
        placesFree: free,
        urgent,
        showing: r.showing,
        offers: r.offers,
        offering: urgent && r.showing && !r.stopped,
        requirements: needs,
        lastCancel: c
          ? {
              worker: c.name,
              at: date(c.cancelled_at),
              noticeHours: Number(c.notice_hours ?? 0),
              byCasual: c.status === "cancelled_worker",
              strike: c.strike,
            }
          : null,
      });
    }
  }
  // Urgent first, then soonest.
  open.sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || a.startsAt.getTime() - b.startsAt.getTime(),
  );

  // The first wave's size for one place, as the waves will send it (unknown if the firm's
  // settings don't read).
  const { rows: firm } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`select settings from firms where id = app_current_firm_id()`,
  );
  let firstWave: number | null = null;
  try {
    const settings = firm[0]?.settings ?? {};
    firstWave = waveCap(parseAllocationSettings(settings), firstComeWaves(settings), 1);
  } catch {
    firstWave = null;
  }

  // The event's cancellations, newest first (every session, past ones too).
  const { rows: cancelRows } = await tx.execute<{
    id: string;
    name: string;
    role: string;
    starts_at: string | Date;
    cancelled_at: string | Date;
    notice_hours: string | number | null;
    status: string;
    strike: "live" | "withdrawn" | null;
  }>(sql`
    select a.id::text as id, trim(w.first_name || ' ' || w.last_name) as name, s.role,
           s.starts_at, a.cancelled_at, a.notice_hours, a.status,
           (select st.status from strikes st
             where st.firm_id = a.firm_id and st.assignment_id = a.id
             order by st.issued_at desc limit 1) as strike
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
     where s.event_id = ${eventId}::uuid and a.status in (${CANCELLED_STATUSES})
       and a.cancelled_at is not null
     order by a.cancelled_at desc, a.id
     limit ${STAFFING_CANCELLATIONS}
  `);

  // Its history: the event, its sessions, their bookings and offers, newest first.
  const { rows: eventRows } = await tx.execute<{
    action: string;
    actor_type: string;
    actor_id: string | null;
    data: Record<string, unknown>;
    created_at: string | Date;
  }>(sql`
    select ev.action, ev.actor_type, ev.actor_id, ev.data, ev.created_at from events ev
     where ev.entity_id = ${eventId}::uuid
        or ev.entity_id in (select s.id from shifts s where s.event_id = ${eventId}::uuid)
        or ev.entity_id in (select a.id from assignments a
                              join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
                             where s.event_id = ${eventId}::uuid)
        or ev.entity_id in (select o.id from offers o
                              join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
                             where s.event_id = ${eventId}::uuid)
     order by ev.id desc
     limit ${STAFFING_HISTORY}
  `);
  const workerIds = new Set<string>();
  const officeIds = new Set<string>();
  for (const e of eventRows) {
    if (typeof e.data.workerId === "string") workerIds.add(e.data.workerId);
    if (typeof e.data.offeredBy === "string") officeIds.add(e.data.offeredBy);
    if (typeof e.data.officeUserId === "string") officeIds.add(e.data.officeUserId);
    if (e.actor_type === "office" && e.actor_id) officeIds.add(e.actor_id);
  }
  const uuids = (set: Set<string>) => [...set].filter((id) => z.uuid().safeParse(id).success);
  const workerNames = new Map(
    (uuids(workerIds).length
      ? await tx
          .select({ id: workers.id, first: workers.firstName, last: workers.lastName })
          .from(workers)
          .where(inArray(workers.id, uuids(workerIds)))
      : []
    ).map((w) => [w.id, `${w.first} ${w.last}`]),
  );
  const officeNames = new Map(
    (uuids(officeIds).length
      ? await tx
          .select({ id: officeUsers.id, name: officeUsers.name })
          .from(officeUsers)
          .where(inArray(officeUsers.id, uuids(officeIds)))
      : []
    ).map((o) => [o.id, o.name]),
  );
  const names = {
    worker: (id: unknown) => workerNames.get(String(id)) ?? "Someone",
    office: (id: unknown) => officeNames.get(String(id)) ?? "The office",
  };

  const all = [...roles.values()];
  return {
    venue: venueRows[0] ?? null,
    sessions,
    roles: all,
    booked: all.reduce((n, r) => n + r.booked, 0),
    needed: all.reduce((n, r) => n + r.needed, 0),
    open,
    firstWave,
    offerNow: (await openPlacesInWindow(tx, eventId, now)).reduce((n, o) => n + o.free, 0),
    cancellations: cancelRows.map((c) => ({
      assignmentId: c.id,
      worker: c.name,
      role: c.role,
      startsAt: date(c.starts_at),
      at: date(c.cancelled_at),
      noticeHours: Number(c.notice_hours ?? 0),
      byCasual: c.status === "cancelled_worker",
      strike: c.strike,
    })),
    history: eventRows.map((e) => ({
      at: date(e.created_at),
      words: eventWords(
        { action: e.action, actorType: e.actor_type, actorId: e.actor_id, data: e.data },
        names,
      ),
    })),
  };
}
