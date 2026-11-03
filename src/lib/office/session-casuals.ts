import { sql } from "drizzle-orm";
import { readRequirements } from "../credentials/requirements";
import { uuidArray } from "../db/arrays";
import { CANCELLED_ASSIGNMENT_STATUSES } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { pairKey } from "../roster/eligibility-input";
import { previewBookings } from "../roster/book";
import type { Reliability } from "../rules/reliability";
import { localDateOf } from "../time/zoned";
import { straightLineMetres } from "../travel/distance";
import { nearestMinutes } from "../travel/area";
import { travelOn } from "../travel/on";
import { loadCasualRecords } from "./reliability";

// "Casuals for this session" (Phase 26.6, ses-2 to ses-4; docs/screens.md "A session, round 8"):
// who asked for it, who was offered it, who said no, who's booked and who else could take it, each
// with what they hold (the session's qualifications they have), how often they've worked at the
// venue, live strikes, their reliability (src/lib/rules/reliability.ts) and how far they are.
// Reads only, inside the firm's transaction. Who can be booked is the rules' answer on the current
// rows (previewBookings: never a pass); booking itself runs every check again (bookShift).
//
// - Asked for it: asks waiting, then the office's "Not this time" ones (marked);
// - Offered: offers not answered no (waiting, run out, filled, failed), the latest each;
// - Said no: offers they declined;
// - Booked: holding a place now;
// - Could take it: active casuals with the role the rules allow now, who haven't asked, been
//   offered it or been booked (at most COULD_TAKE_MAX, the most reliable first).
// Most reliable first in each: a figure from 90 days, highest first, then New (most shifts so far
// first), then by name.

export const CASUALS_TABS = ["asked", "offered", "said_no", "booked", "could"] as const;
export type CasualsTab = (typeof CASUALS_TABS)[number];

export const COULD_TAKE_MAX = 100;
const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface SessionCasual {
  workerId: string;
  name: string;
  holds: string[]; // the session's qualifications they hold, by name
  workedHere: number; // sessions marked worked at this venue
  liveStrikes: number;
  reliability: Reliability;
  miles: number | null; // straight line from their home area to the venue, 1 decimal place
  minutes: number | null; // the quickest of their ways there (the travel job), null: not known
  when: Date | null; // asked at / offered at / said no at / booked
  notThisTime: boolean; // the office's "Not this time" (Asked for it)
  offer: string | null; // the offer's answer (Offered): null waiting, "expired", "filled_elsewhere"...
  canBook: boolean; // the rules say yes now, and a place is free
  reasons: string[]; // the rules' no, in plain English
}

export interface CasualsFilters {
  reliable?: boolean; // 80% or more
  near?: boolean; // within 45 minutes (only with travel areas on)
  here?: boolean; // worked at this venue before
}

export interface SessionCasuals {
  eventId: string;
  casualsAsk: boolean; // the event's "Casuals ask, you choose"
  travelOn: boolean;
  placesLeft: number;
  counts: Record<CasualsTab, number>; // before the filters
  rows: Record<CasualsTab, SessionCasual[]>; // after the filters
  best: SessionCasual[]; // "Book the best N": asks waiting the rules allow, most reliable first
  couldMore: boolean; // more could take it than COULD_TAKE_MAX
}

export const RELIABLE_FILTER = 80;
export const NEAR_FILTER_MINUTES = 45;

const MILE = 1609.344;

export function byReliability(a: SessionCasual, b: SessionCasual): number {
  const score = (c: SessionCasual) =>
    c.reliability.kind === "figure" ? 1000 + c.reliability.percent : c.reliability.counted;
  return score(b) - score(a) || a.name.localeCompare(b.name);
}

export async function loadSessionCasuals(
  tx: FirmTx,
  s: {
    shiftId: string;
    eventId: string;
    role: string;
    siteId: string | null;
    startsAt: Date;
    headcount: number;
    status: string;
    requiredCredentials: string[];
    timeZone: string;
  },
  now: Date,
  filters: CasualsFilters = {},
): Promise<SessionCasuals> {
  const { rows: setting } = await tx.execute<{ casuals_ask: boolean }>(
    sql`select casuals_ask from shift_events where id = ${s.eventId}`,
  );
  const { rows: asks } = await tx.execute<{
    worker_id: string;
    status: "asked" | "not_this_time";
    asked_at: Date | string;
  }>(sql`
    select worker_id::text, status, asked_at from session_asks
     where shift_id = ${s.shiftId} and status in ('asked', 'not_this_time')
  `);
  // Each casual's latest offer of it.
  const { rows: offerRows } = await tx.execute<{
    worker_id: string;
    response: string | null;
    sent_at: Date | string;
    responded_at: Date | string | null;
  }>(sql`
    select distinct on (worker_id) worker_id::text, response, sent_at, responded_at from offers
     where shift_id = ${s.shiftId}
     order by worker_id, sent_at desc
  `);
  const { rows: bookedRows } = await tx.execute<{
    worker_id: string;
    confirmed_at: Date | null;
    in_place: boolean;
  }>(
    sql`
    select a.worker_id::text, a.confirmed_at, a.slot <= ${s.headcount} as in_place
      from assignments a
     where a.shift_id = ${s.shiftId} and a.worker_id is not null and a.status not in (${CANCELLED})
  `,
  );
  const booked = new Set(bookedRows.map((b) => b.worker_id));
  const asked = new Map(asks.filter((a) => !booked.has(a.worker_id)).map((a) => [a.worker_id, a]));
  const offered = new Map(
    offerRows.filter((o) => !booked.has(o.worker_id)).map((o) => [o.worker_id, o]),
  );
  // Places taken as booking counts them: bookings in the session's places (a booking above them,
  // after the places went down, holds none).
  const taken = bookedRows.filter((b) => b.in_place).length;
  const placesLeft =
    s.status === "open" && s.startsAt.getTime() > now.getTime()
      ? Math.max(0, s.headcount - taken)
      : 0;

  // Who else could take it: active casuals with the role, not already in a list.
  const { rows: roleHolders } = await tx.execute<{ id: string }>(sql`
    select w.id::text from workers w
     where w.status = 'active' and ${s.role} = any (w.roles)
     order by w.last_name, w.first_name, w.id
  `);
  const others = roleHolders
    .map((r) => r.id)
    .filter((id) => !booked.has(id) && !asked.has(id) && !offered.has(id));

  const everyone = [...new Set([...asked.keys(), ...offered.keys(), ...booked, ...others])];
  const verdicts = await previewBookings(tx, {
    shiftIds: [s.shiftId],
    workerIds: everyone,
    now,
  });
  const verdictOf = (id: string) => verdicts.get(pairKey(s.shiftId, id));
  const couldAll = others.filter((id) => verdictOf(id)?.ok);
  // Every one is read and ranked, then the most reliable COULD_TAKE_MAX shown.
  const could = couldAll;
  const shown = [...new Set([...asked.keys(), ...offered.keys(), ...booked, ...could])];

  const facts = new Map<
    string,
    {
      name: string;
      held: string[];
      workedHere: number;
      liveStrikes: number;
      home: { lat: number; lng: number } | null;
      minutes: number | null;
    }
  >();
  let site: { lat: number; lng: number } | null = null;
  if (s.siteId) {
    const { rows } = await tx.execute<{ lat: string | null; lng: string | null }>(
      sql`select lat::text, lng::text from sites where id = ${s.siteId}`,
    );
    const r = rows[0];
    if (r?.lat && r.lng) site = { lat: Number(r.lat), lng: Number(r.lng) };
  }
  if (shown.length > 0) {
    const today = localDateOf(now, s.timeZone);
    const minutes = s.siteId
      ? nearestMinutes({
          firmId: sql`w.firm_id`,
          workerId: sql`w.id`,
          siteId: sql`${s.siteId}::uuid`,
          startsAt: sql`${s.startsAt}::timestamptz`,
        })
      : sql`null::int`;
    const { rows } = await tx.execute<{
      id: string;
      first_name: string;
      last_name: string;
      held: string[];
      worked_here: number;
      live_strikes: number;
      home_lat: string | null;
      home_lng: string | null;
      minutes: number | null;
    }>(sql`
      select w.id::text, w.first_name, w.last_name,
             array(select c.type from credentials c
                    where c.firm_id = w.firm_id and c.worker_id = w.id and c.status = 'valid'
                      and (c.expires_on is null or c.expires_on >= ${today}::date)) as held,
             (select count(*)::int from assignments a
                join shifts s2 on s2.firm_id = a.firm_id and s2.id = a.shift_id
               where a.firm_id = w.firm_id and a.worker_id = w.id and a.status = 'completed'
                 and s2.site_id is not distinct from ${s.siteId}::uuid
                 and ${s.siteId}::uuid is not null) as worked_here,
             (select count(*)::int from strikes st
               where st.firm_id = w.firm_id and st.worker_id = w.id and st.status = 'live'
                 and st.expires_at > ${now}) as live_strikes,
             t.lat::text as home_lat, t.lng::text as home_lng,
             ${minutes} as minutes
        from workers w
        left join worker_travel t on t.firm_id = w.firm_id and t.worker_id = w.id
       where w.id = any(${uuidArray(shown)})
    `);
    for (const r of rows) {
      facts.set(r.id, {
        name: `${r.first_name} ${r.last_name}`,
        held: r.held,
        workedHere: r.worked_here,
        liveStrikes: r.live_strikes,
        home:
          r.home_lat !== null && r.home_lng !== null
            ? { lat: Number(r.home_lat), lng: Number(r.home_lng) }
            : null,
        minutes: r.minutes,
      });
    }
  }
  const records = await loadCasualRecords(tx, now, shown);
  const needs = (await readRequirements(tx, [s.role])).of(s.role, s.requiredCredentials);

  const build = (
    id: string,
    extra: Partial<Pick<SessionCasual, "when" | "notThisTime" | "offer">>,
  ): SessionCasual | null => {
    const f = facts.get(id);
    const record = records.get(id);
    if (!f || !record) return null;
    const verdict = verdictOf(id);
    const held = new Set(f.held);
    return {
      workerId: id,
      name: f.name,
      holds: needs.filter((n) => held.has(n.code)).map((n) => n.name),
      workedHere: f.workedHere,
      liveStrikes: f.liveStrikes,
      reliability: record.reliability,
      miles:
        f.home && site ? Math.round((straightLineMetres(f.home, site) / MILE) * 10) / 10 : null,
      minutes: f.minutes,
      when: extra.when ?? null,
      notThisTime: extra.notThisTime ?? false,
      offer: extra.offer ?? null,
      canBook: placesLeft > 0 && verdict?.ok === true,
      reasons: verdict && !verdict.ok ? verdict.reasons : [],
    };
  };
  const keep = (list: (SessionCasual | null)[]) =>
    list.filter((c): c is SessionCasual => c !== null);
  const at = (d: Date | string | null) => (d === null ? null : new Date(d));

  const all: Record<CasualsTab, SessionCasual[]> = {
    asked: keep(
      [...asked.values()].map((a) =>
        build(a.worker_id, { when: at(a.asked_at), notThisTime: a.status === "not_this_time" }),
      ),
    ).sort((a, b) => Number(a.notThisTime) - Number(b.notThisTime) || byReliability(a, b)),
    offered: keep(
      [...offered.values()]
        .filter((o) => o.response !== "declined")
        .map((o) => build(o.worker_id, { when: at(o.sent_at), offer: o.response })),
    ).sort(byReliability),
    said_no: keep(
      [...offered.values()]
        .filter((o) => o.response === "declined")
        .map((o) => build(o.worker_id, { when: at(o.responded_at), offer: o.response })),
    ).sort(byReliability),
    booked: keep(bookedRows.map((b) => build(b.worker_id, { when: at(b.confirmed_at) }))).sort(
      byReliability,
    ),
    could: keep(could.map((id) => build(id, {})))
      .sort(byReliability)
      .slice(0, COULD_TAKE_MAX),
  };
  const counts = {
    asked: all.asked.length,
    offered: all.offered.length,
    said_no: all.said_no.length,
    booked: all.booked.length,
    could: couldAll.length,
  };
  const on = await travelOn(tx);
  const pass = (c: SessionCasual) =>
    (!filters.reliable ||
      (c.reliability.kind === "figure" && c.reliability.percent >= RELIABLE_FILTER)) &&
    (!filters.near || !on || (c.minutes !== null && c.minutes <= NEAR_FILTER_MINUTES)) &&
    (!filters.here || c.workedHere > 0);
  const rows = Object.fromEntries(
    CASUALS_TABS.map((t) => [t, t === "booked" ? all.booked : all[t].filter(pass)]),
  ) as Record<CasualsTab, SessionCasual[]>;
  return {
    eventId: s.eventId,
    casualsAsk: setting[0]?.casuals_ask === true,
    travelOn: on,
    placesLeft,
    counts,
    rows,
    best: all.asked.filter((c) => !c.notThisTime && c.canBook).slice(0, placesLeft),
    couldMore: couldAll.length > COULD_TAKE_MAX,
  };
}
