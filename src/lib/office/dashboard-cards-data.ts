import { sql, type SQL } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";
import { addDays, localDateOf, startOfDay } from "../time/zoned";
import { sitesSql } from "./contract-scope";
import { bookedJoin, placeFree } from "./events";
import { offerStateSql } from "./offer-state";

// The dashboard's extra cards (Phase 26.3; the spec page's cus-3, the pre-build audit's aud-9,
// aud-10 and aud-13), each counted by code from the firm's own records, under the person's
// contracts when they've chosen some (`sites`: their venues; null: every venue):
//
// - Next 2 weeks: each day from today, its places booked, offered with no reply yet, and open
//   (no offer waiting), on sessions still to come that aren't cancelled.
// - Cancellations: each of the last 8 weeks (Monday to Sunday, the firm's time), bookings cancelled
//   in it (by a casual or the firm: the Cancellations page's), under 48 hours' notice and not.
// - No-shows: each of the last 8 weeks, people marked as not attending sessions that started in it.
// - Fill rate: each contract's places in the next 14 days, booked of needed (sessions at venues
//   with no contract together, as "No contract").

export const CARD_DAYS = 14;
export const CARD_WEEKS = 8;

// A session's venue: its own, else its event's.
const venue = sql`coalesce(s.site_id, e.site_id)`;
const eventJoin = sql`join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id`;
const siteSql = (sites: string[] | null): SQL => sql`and ${sitesSql(sites)}`;

export interface DayPlaces {
  date: string;
  booked: number;
  offered: number;
  open: number;
}

export async function loadNextTwoWeeks(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  sites: string[] | null,
): Promise<DayPlaces[]> {
  const today = localDateOf(now, timeZone);
  const after = addDays(today, CARD_DAYS);
  const { rows } = await tx.execute<{
    day: string;
    booked: number;
    offered: number;
    open: number;
  }>(sql`
    select to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
           coalesce(sum(b.booked), 0)::int as booked,
           coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)} and w.waiting), 0)::int as offered,
           coalesce(sum(s.headcount - b.booked) filter (where ${placeFree(now)} and not w.waiting), 0)::int as open
      from shifts s
      ${eventJoin}
      ${bookedJoin}
      cross join lateral (
        select exists (select 1 from offers o
                        where o.firm_id = s.firm_id and o.shift_id = s.id
                          and ${offerStateSql(now)} = 'waiting') as waiting
      ) w
     where s.status in ('open', 'filled')
       and s.starts_at >= ${now}
       and s.starts_at < ${startOfDay(after, timeZone)}
       ${siteSql(sites)}
     group by 1
  `);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: CARD_DAYS }, (_, i) => {
    const date = addDays(today, i);
    const r = byDay.get(date);
    return { date, booked: r?.booked ?? 0, offered: r?.offered ?? 0, open: r?.open ?? 0 };
  });
}

// The last 8 weeks, Monday to Sunday in the firm's time, this week last (its Monday's date).
export function lastWeeks(now: Date, timeZone: string, count = CARD_WEEKS): string[] {
  const today = localDateOf(now, timeZone);
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  const monday = addDays(today, -dow);
  return Array.from({ length: count }, (_, i) => addDays(monday, (i - count + 1) * 7));
}
const weekOf = (day: string, weeks: string[]) => {
  for (let i = weeks.length - 1; i >= 0; i--) if (day >= weeks[i]!) return i;
  return -1;
};

export interface CancelWeek {
  week: string; // its Monday
  short: number; // under 48 hours' notice
  longer: number;
}

export async function loadCancelWeeks(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  sites: string[] | null,
): Promise<CancelWeek[]> {
  const weeks = lastWeeks(now, timeZone);
  const { rows } = await tx.execute<{ day: string; short: boolean }>(sql`
    select to_char(a.cancelled_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
           coalesce(a.notice_hours < 48, false) as short
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      ${eventJoin}
     where a.status in ('cancelled_worker', 'cancelled_firm')
       and a.cancelled_at >= ${startOfDay(weeks[0]!, timeZone)}
       and a.cancelled_at <= ${now}
       ${siteSql(sites)}
  `);
  const out = weeks.map((week) => ({ week, short: 0, longer: 0 }));
  for (const r of rows) {
    const w = out[weekOf(r.day, weeks)];
    if (!w) continue;
    if (r.short) w.short += 1;
    else w.longer += 1;
  }
  return out;
}

export interface NoShowWeek {
  week: string;
  noShows: number;
}

export async function loadNoShowWeeks(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  sites: string[] | null,
): Promise<NoShowWeek[]> {
  const weeks = lastWeeks(now, timeZone);
  const { rows } = await tx.execute<{ day: string }>(sql`
    select to_char(s.starts_at at time zone ${timeZone}, 'YYYY-MM-DD') as day
      from assignments a
      join shifts s on s.firm_id = a.firm_id and s.id = a.shift_id
      ${eventJoin}
     where a.status = 'no_show'
       and s.starts_at >= ${startOfDay(weeks[0]!, timeZone)}
       and s.starts_at <= ${now}
       ${siteSql(sites)}
  `);
  const out = weeks.map((week) => ({ week, noShows: 0 }));
  for (const r of rows) {
    const w = out[weekOf(r.day, weeks)];
    if (w) w.noShows += 1;
  }
  return out;
}

export interface ContractFill {
  clientId: string | null; // null: venues with no contract
  name: string | null;
  needed: number;
  booked: number;
}

export async function loadFillRates(
  tx: FirmTx,
  now: Date,
  timeZone: string,
  sites: string[] | null,
): Promise<ContractFill[]> {
  const after = addDays(localDateOf(now, timeZone), CARD_DAYS);
  const { rows } = await tx.execute<{
    client_id: string | null;
    name: string | null;
    needed: number;
    booked: number;
  }>(sql`
    select c.id::text as client_id, c.name,
           sum(s.headcount)::int as needed, sum(least(b.booked, s.headcount))::int as booked
      from shifts s
      ${eventJoin}
      ${bookedJoin}
      left join sites v on v.firm_id = s.firm_id and v.id = ${venue}
      left join clients c on c.firm_id = v.firm_id and c.id = v.client_id
     where s.status in ('open', 'filled')
       and s.starts_at >= ${now}
       and s.starts_at < ${startOfDay(after, timeZone)}
       ${siteSql(sites)}
     group by c.id, c.name
     order by c.name nulls last
  `);
  return rows.map((r) => ({
    clientId: r.client_id,
    name: r.name,
    needed: r.needed,
    booked: r.booked,
  }));
}
