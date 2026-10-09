import { sql, type SQL } from "drizzle-orm";
import { ARRIVE_BEFORE_MINUTES } from "./estimate-queue";
import type { TravelMode } from "./modes";

// A casual's travel area (docs/office-v2.md 4.3, 5.4; D2, Rules 14; 12G.3): which shifts it lets
// them see and be offered. A preference, not a rules check: the rules engine never reads it, a
// shift opened from a direct link stays bookable, and the office may still offer outside it by
// hand.
//
// - In: any way she chose gets there within her limit (the travel job's estimate, 12G.2).
// - Out: every way she chose has an estimate, and none is within (over the limit, or beyond the
//   90-minute ceiling).
// - Unknown: anything else (a way not worked out yet, a site with no location): shown, labelled
//   "Distance not known yet" or the straight line, and still offered. Never hidden silently.
// - No area: everything shown, with a prompt to add one.
//
// areaVerdict() is the rule; outsideArea() and nearestMinutes() are the same rule as SQL, so the
// filter and the order run inside the database query (before the open-shifts cap). A test holds
// the two together (tests/integration/travel.filter.test.ts).

export interface TravelArea {
  modes: TravelMode;
  maxMinutes: number;
}

// One way's estimate: absent (not worked out yet), or minutes (null: beyond the 90-minute ceiling,
// or no public transport in time).
export type WayEstimate = { minutes: number | null } | undefined;

export type AreaVerdict = "in" | "out" | "unknown" | "no_area";

const chosen = (modes: TravelMode): ("car" | "public_transport")[] =>
  modes === "both" ? ["car", "public_transport"] : [modes];

export function areaVerdict(
  area: TravelArea | null,
  site: { located: boolean },
  estimates: { car: WayEstimate; public_transport: WayEstimate },
): AreaVerdict {
  if (!area) return "no_area";
  if (!site.located) return "unknown";
  const ways = chosen(area.modes).map((w) => estimates[w]);
  const within = (e: WayEstimate) =>
    e !== undefined && e.minutes !== null && e.minutes <= area.maxMinutes;
  if (ways.some(within)) return "in";
  return ways.every((e) => e !== undefined) ? "out" : "unknown";
}

// The shift's arrive-by time, as the travel job keys its estimates (30 minutes before the start).
const arriveBy = (startsAt: SQL) =>
  sql`${startsAt} - make_interval(mins => ${ARRIVE_BEFORE_MINUTES})`;

// One way's estimate for the casual's postcode, the shift's site and arrive-by time, ruling the
// shift out: there, and not within the limit. (A way she didn't choose never rules it out.)
const rulesOut = (mode: "car" | "public_transport", startsAt: SQL) => sql`(t.modes not in
  (${mode}, 'both') or exists (select 1 from travel_estimates e
     where e.firm_id = t.firm_id and e.site_id = si.id and e.mode = ${mode}
       and e.origin_postcode = t.start_postcode and e.arrive_by = ${arriveBy(startsAt)}
       and (e.minutes is null or e.minutes > t.max_minutes)))`;

// True when the casual's area rules the shift out ("out" above). False with no area, a shift with
// no site or a site with no location, or a way not worked out yet. The arguments are SQL for the
// firm, the casual, the shift's site and its start, so it works for one casual and many shifts
// (the lists) or one shift and many casuals (offer waves).
export function outsideArea(p: { firmId: SQL; workerId: SQL; siteId: SQL; startsAt: SQL }): SQL {
  return sql`exists (select 1 from worker_travel t
      join sites si on si.firm_id = t.firm_id and si.id = ${p.siteId}
     where t.firm_id = ${p.firmId} and t.worker_id = ${p.workerId}
       and si.lat is not null and si.lng is not null
       and ${rulesOut("car", p.startsAt)} and ${rulesOut("public_transport", p.startsAt)})`;
}

// The quickest of the casual's chosen ways to the shift, in minutes, or null (no area, or not worked
// out yet, or out of reach every way): the "nearest" in the lists' order.
export function nearestMinutes(p: {
  firmId: SQL;
  workerId: SQL;
  siteId: SQL;
  startsAt: SQL;
}): SQL<number | null> {
  return sql<number | null>`(select min(e.minutes) from worker_travel t
      join travel_estimates e on e.firm_id = t.firm_id and e.origin_postcode = t.start_postcode
     where t.firm_id = ${p.firmId} and t.worker_id = ${p.workerId}
       and e.site_id = ${p.siteId} and e.arrive_by = ${arriveBy(p.startsAt)}
       and e.minutes is not null and (t.modes = 'both' or t.modes = e.mode))`;
}
