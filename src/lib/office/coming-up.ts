import { sql } from "drizzle-orm";
import { uuidArray } from "../db/arrays";
import type { FirmTx } from "../db/scoped";
import {
  COMING_UP_SHOWN,
  comingUpDays,
  type AskedType,
  type ComingUpLicence,
} from "./coming-up-copy";
import { sitesSql } from "./contract-scope";
import { loadExpiredOnBookings } from "./dashboard";
import { requestWaiting } from "./enquiry-sql";

// The dashboard's Coming up (Phase 27.9; Dylan, 2026-11-05: "simplify the what needs updating to
// staff working on any of your contracts coming up"; docs/screens.md "/office, round 8"): who's
// working on the person's contracts today and tomorrow, by session, each person by name. Reads
// only, inside the firm's transaction (every query through the FirmTx: RLS scopes each row to it;
// joins on the composite keys). Nothing here decides anything new: a person's licence flag is the
// credential rule's own (dashboard.ts loadExpiredOnBookings, Needs attention's), and their asked
// flag is a request still waiting for an answer as Enquiries counts it (enquiry-sql.ts
// requestWaiting). Names and ids only, as the office already sees.
//
// - The sessions: open or filled (as the credential rule and Needs attention read them: a draft
//   is never shown with no licence check), at the person's contracts' venues (a session's own venue, else
//   its event's; every venue when they have none or asked for everything), not ended yet, starting
//   before the end of tomorrow (the firm's calendar), with at least one confirmed booking; soonest
//   first, the first COMING_UP_SHOWN, and how many there are in all and how many people on them.
// - Each: its role, venue (or event), times, places, how many are booked (its confirmed bookings,
//   so the number and the names listed always agree), and those people, A to Z.

export interface ComingUpPerson {
  workerId: string;
  name: string;
  // A qualification the session needs won't be in date for it (the first to run out); null: no
  // such flag (not a clearance to work: Needs attention's other checks, such as a blocked casual,
  // aren't shown here).
  licence: ComingUpLicence | null;
  // A time change or swap they asked for on this session, still waiting for an answer.
  asked: { requestId: string; type: AskedType } | null;
}

export interface ComingUpSession {
  shiftId: string;
  role: string;
  site: string | null; // its own venue, else its event's
  eventName: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  booked: number;
  people: ComingUpPerson[];
}

export interface ComingUp {
  sessions: ComingUpSession[]; // soonest first, the first COMING_UP_SHOWN
  total: number; // sessions in all
  people: number; // people booked on them in all (each once)
  more: boolean; // there were more than COMING_UP_SHOWN
}

const date = (v: string | Date) => new Date(v);

export async function loadComingUp(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  // A person's contracts' venues (Phase 26.3; null: every venue).
  mine: string[] | null = null,
): Promise<ComingUp> {
  const { end } = comingUpDays(now, timeZone);
  const { rows } = await tx.execute<{
    shift_id: string;
    role: string;
    site: string | null;
    event_name: string;
    starts_at: string | Date;
    ends_at: string | Date;
    headcount: number;
    booked: number;
    total: number;
    people: number;
  }>(sql`
    with coming as (
      select s.firm_id, s.id, s.role, coalesce(si.name, esi.name) as site, e.name as event_name,
             s.starts_at, s.ends_at, s.headcount, b.booked
        from shifts s
        join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
        cross join lateral (
          select count(*)::int as booked from assignments a
           where a.firm_id = s.firm_id and a.shift_id = s.id
             and a.status = 'confirmed' and a.worker_id is not null) b
        left join sites si on si.firm_id = s.firm_id and si.id = s.site_id
        left join sites esi on esi.firm_id = e.firm_id and esi.id = e.site_id
       where s.status in ('open', 'filled') and s.ends_at > ${now} and s.starts_at < ${end}
         and ${sitesSql(mine)} and b.booked > 0
    )
    select c.id::text as shift_id, c.role, c.site, c.event_name, c.starts_at, c.ends_at,
           c.headcount, c.booked, (count(*) over ())::int as total,
           (select count(distinct a.worker_id)::int
              from assignments a
              join coming x on x.firm_id = a.firm_id and x.id = a.shift_id
             where a.status = 'confirmed') as people
      from coming c
     order by c.starts_at, c.id
     limit ${COMING_UP_SHOWN + 1}
  `);
  const shown = rows.slice(0, COMING_UP_SHOWN);
  const ids = shown.map((r) => r.shift_id);
  if (ids.length === 0) return { sessions: [], total: 0, people: 0, more: false };

  // Who's booked on them, A to Z.
  const { rows: booked } = await tx.execute<{
    assignment_id: string;
    shift_id: string;
    worker_id: string;
    first_name: string;
    last_name: string;
  }>(sql`
    select a.id::text as assignment_id, a.shift_id::text as shift_id, w.id::text as worker_id,
           w.first_name, w.last_name
      from assignments a
      join workers w on w.firm_id = a.firm_id and w.id = a.worker_id
     where a.status = 'confirmed' and a.shift_id = any(${uuidArray(ids)})
     order by w.first_name, w.last_name, w.id
  `);

  // Their licences, as Needs attention reads them: for each booking, the first to run out (one
  // marked expired with no date counts as out already).
  const expired = await loadExpiredOnBookings(tx, now, timeZone, ids);
  const licence = new Map<string, ComingUpLicence>();
  for (const e of expired.items) {
    const had = licence.get(e.assignmentId);
    const sooner =
      !had || (had.expiresOn !== null && (e.expiresOn === null || e.expiresOn < had.expiresOn));
    if (sooner) licence.set(e.assignmentId, { credential: e.credential, expiresOn: e.expiresOn });
  }

  // Their time changes and swaps on these sessions still waiting for an answer, the first asked.
  const { rows: asks } = await tx.execute<{
    request_id: string;
    shift_id: string;
    worker_id: string;
    type: AskedType;
  }>(sql`
    select q.id::text as request_id, q.shift_id::text as shift_id, q.worker_id::text as worker_id,
           q.type
      from requests q
     where q.shift_id = any(${uuidArray(ids)}) and q.type in ('time_change', 'swap')
       and ${requestWaiting("q")}
     order by q.created_at, q.id
  `);
  const asked = new Map<string, { requestId: string; type: AskedType }>();
  for (const q of asks) {
    const key = `${q.shift_id}/${q.worker_id}`;
    if (!asked.has(key)) asked.set(key, { requestId: q.request_id, type: q.type });
  }

  const first = rows[0]!;
  return {
    total: first.total,
    people: first.people,
    more: rows.length > COMING_UP_SHOWN,
    sessions: shown.map((r) => ({
      shiftId: r.shift_id,
      role: r.role,
      site: r.site,
      eventName: r.event_name,
      startsAt: date(r.starts_at),
      endsAt: date(r.ends_at),
      headcount: r.headcount,
      booked: r.booked,
      people: booked
        .filter((p) => p.shift_id === r.shift_id)
        .map((p) => ({
          workerId: p.worker_id,
          name: `${p.first_name} ${p.last_name}`,
          licence: licence.get(p.assignment_id) ?? null,
          asked: asked.get(`${p.shift_id}/${p.worker_id}`) ?? null,
        })),
    })),
  };
}
