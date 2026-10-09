import { eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { listFirmIds } from "../db/directory";
import { firms, sites, travelEstimates, type EstimateMode } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import type { FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { localDateOf } from "../time/zoned";
import {
  ARRIVE_BEFORE_MINUTES,
  ESTIMATE_KEEP_DAYS,
  ESTIMATE_WINDOW_DAYS,
  queueWindowEstimates,
  TRAVEL_ESTIMATES_QUEUE,
  travelEstimatesPayload,
  type TravelEstimatesPayload,
} from "./estimate-queue";
import type { Point } from "./geocoder";
import { SEARCH_MAX_ORIGINS, type TravelProvider, type Trip } from "./provider";
import { workerTravelProvider } from "./worker-provider";

// The travel job (docs/office-v2.md 5.4; 12G.2): fills in the travel estimates sessions are missing.
// Worker only; a page never calls the provider.
//
// - Which sessions: the ones asked for, or every one in the window (the nightly run); open or
//   booked, not started, at a site whose point is known.
// - One search per site, arrive-by time (30 minutes before the start, an absolute time, so the
//   clock change can't move it) and way of travelling, car and public transport both (a casual
//   sees both times, whichever they chose). Sessions sharing a site and start share searches.
// - The start points are the distinct postcodes of active casuals with one of those sessions'
//   roles, only those with no estimate yet, in batches of SEARCH_MAX_ORIGINS. Each goes to the
//   provider as its point under a meaningless id ("o1"), never the postcode.
// - The searches happen outside any transaction. Each answer is saved in its own transaction,
//   only if the site's point is still the one searched (a postcode change meanwhile deletes the
//   site's estimates and queues new ones), expiring 7 days after the last session it's for.
// - A provider that doesn't answer stops the run (no hammering): what was saved stays, and the job
//   fails, so pg-boss tries again; the nightly run catches up after that.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MODES: readonly EstimateMode[] = ["car", "public_transport"];

export class TravelUnavailableError extends Error {
  constructor() {
    super("the travel provider didn't answer");
    this.name = "TravelUnavailableError";
  }
}

export interface EstimateDeps {
  provider: TravelProvider;
  clock: Clock;
}

export interface FillResult {
  searches: number;
  saved: number; // estimates added or refreshed
  unavailable: boolean; // the provider stopped answering
}

interface Group {
  siteId: string;
  site: Point;
  arriveBy: Date;
  expiresAt: Date;
  roles: Set<string>;
}

interface Origin {
  postcode: string;
  point: Point;
}

const keyOf = (siteId: string, arriveBy: Date) => `${siteId}|${arriveBy.toISOString()}`;

// The sessions' groups, with each group's start points still missing an estimate, per way.
async function plan(
  run: WithFirm,
  firmId: string,
  scope: { shiftIds: readonly string[] } | { window: true },
  now: Date,
): Promise<{ group: Group; mode: EstimateMode; origins: Origin[] }[]> {
  return run(firmId, async (tx) => {
    const which =
      "window" in scope
        ? sql`s.starts_at < ${now}::timestamptz + make_interval(days => ${ESTIMATE_WINDOW_DAYS})`
        : sql`s.id in (${sql.join(
            scope.shiftIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
    const { rows: sessions } = await tx.execute<{
      role: string;
      starts_at: string | Date;
      ends_at: string | Date;
      site_id: string;
      lat: string;
      lng: string;
    }>(sql`
      select s.role, s.starts_at, s.ends_at, s.site_id::text, si.lat::text, si.lng::text
        from shifts s
        join sites si on si.firm_id = s.firm_id and si.id = s.site_id
       where s.status in ('open', 'filled') and s.starts_at > ${now}
         and si.lat is not null and si.lng is not null and ${which}
       order by s.starts_at, s.id
    `);
    const groups = new Map<string, Group>();
    for (const s of sessions) {
      const arriveBy = new Date(new Date(s.starts_at).getTime() - ARRIVE_BEFORE_MINUTES * MINUTE);
      const expiresAt = new Date(new Date(s.ends_at).getTime() + ESTIMATE_KEEP_DAYS * DAY);
      const key = keyOf(s.site_id, arriveBy);
      const g = groups.get(key);
      if (g) {
        g.roles.add(s.role);
        if (expiresAt > g.expiresAt) g.expiresAt = expiresAt;
      } else {
        groups.set(key, {
          siteId: s.site_id,
          site: { lat: Number(s.lat), lng: Number(s.lng) },
          arriveBy,
          expiresAt,
          roles: new Set([s.role]),
        });
      }
    }
    const work: { group: Group; mode: EstimateMode; origins: Origin[] }[] = [];
    for (const g of groups.values()) {
      // The estimates already there stay as long as this session needs them.
      await tx.execute(sql`
        update travel_estimates set expires_at = ${g.expiresAt}
         where site_id = ${g.siteId} and arrive_by = ${g.arriveBy} and expires_at < ${g.expiresAt}
      `);
      for (const mode of MODES) {
        const { rows } = await tx.execute<{ postcode: string; lat: string; lng: string }>(sql`
          select distinct t.start_postcode as postcode, t.lat::text, t.lng::text
            from worker_travel t
            join workers w on w.firm_id = t.firm_id and w.id = t.worker_id
           where w.status = 'active'
             and w.roles && array[${sql.join(
               [...g.roles].map((r) => sql`${r}`),
               sql`, `,
             )}]::text[]
             and not exists (select 1 from travel_estimates e
                              where e.site_id = ${g.siteId} and e.mode = ${mode}
                                and e.arrive_by = ${g.arriveBy}
                                and e.origin_postcode = t.start_postcode)
           order by t.start_postcode
        `);
        if (rows.length === 0) continue;
        work.push({
          group: g,
          mode,
          origins: rows.map((r) => ({
            postcode: r.postcode,
            point: { lat: Number(r.lat), lng: Number(r.lng) },
          })),
        });
      }
    }
    return work;
  });
}

export async function fillEstimates(
  run: WithFirm,
  firmId: string,
  scope: { shiftIds: readonly string[] } | { window: true },
  deps: EstimateDeps,
): Promise<FillResult> {
  const now = deps.clock.now();
  const result: FillResult = { searches: 0, saved: 0, unavailable: false };
  if ("shiftIds" in scope && scope.shiftIds.length === 0) return result;
  for (const { group, mode, origins } of await plan(run, firmId, scope, now)) {
    for (let i = 0; i < origins.length; i += SEARCH_MAX_ORIGINS) {
      const batch = origins.slice(i, i + SEARCH_MAX_ORIGINS);
      const ids = batch.map((_, n) => `o${n + 1}`);
      result.searches += 1;
      const answer = await deps.provider.search({
        to: group.site,
        arriveBy: group.arriveBy,
        mode,
        from: batch.map((o, n) => ({ id: ids[n] ?? "", point: o.point })),
      });
      if (answer.status === "unavailable") {
        result.unavailable = true;
        return result;
      }
      const found: { postcode: string; trip: Trip }[] = [];
      batch.forEach((o, n) => {
        const id = ids[n] ?? "";
        if (answer.trips.has(id))
          found.push({ postcode: o.postcode, trip: answer.trips.get(id) ?? null });
      });
      if (found.length === 0) continue;
      result.saved += await run(firmId, async (tx) => {
        // Only if the site is still where it was searched.
        const [site] = await tx
          .select({ lat: sites.lat, lng: sites.lng })
          .from(sites)
          .where(eq(sites.id, group.siteId))
          .for("share");
        if (!site || Number(site.lat) !== group.site.lat || Number(site.lng) !== group.site.lng) {
          return 0;
        }
        const values = found.map((f) => ({
          firmId: sql`app_current_firm_id()`,
          originPostcode: f.postcode,
          siteId: group.siteId,
          mode,
          arriveBy: group.arriveBy,
          minutes: f.trip?.minutes ?? null,
          metres: f.trip?.metres ?? null,
          provider: deps.provider.name,
          computedAt: now,
          expiresAt: group.expiresAt,
        }));
        const saved = await tx
          .insert(travelEstimates)
          .values(values)
          .onConflictDoUpdate({
            target: [
              travelEstimates.firmId,
              travelEstimates.originPostcode,
              travelEstimates.siteId,
              travelEstimates.mode,
              travelEstimates.arriveBy,
            ],
            set: {
              minutes: sql`excluded.minutes`,
              metres: sql`excluded.metres`,
              provider: sql`excluded.provider`,
              computedAt: sql`excluded.computed_at`,
              expiresAt: sql`greatest(${travelEstimates.expiresAt}, excluded.expires_at)`,
            },
          })
          .returning({ id: travelEstimates.id });
        return saved.length;
      });
    }
  }
  return result;
}

export function createTravelEstimatesTask(
  deps: () => EstimateDeps,
): FirmTask<TravelEstimatesPayload> {
  return {
    queue: TRAVEL_ESTIMATES_QUEUE,
    schema: travelEstimatesPayload,
    task: async (payload, run) => {
      const scope = payload.window
        ? { window: true as const }
        : { shiftIds: payload.shiftIds ?? [] };
      const result = await fillEstimates(run, payload.firmId, scope, deps());
      if (result.unavailable) throw new TravelUnavailableError();
      return { searches: result.searches, saved: result.saved };
    },
  };
}

const workerDeps = (): EstimateDeps => ({ provider: workerTravelProvider(), clock: systemClock });
export const travelEstimatesTask = createTravelEstimatesTask(workerDeps);

// Before an urgent session's first wave (src/lib/offers/waves.ts): its missing estimates, so the
// travel limit (12G.3) has them. Best-effort: a provider that doesn't answer never holds an offer
// back (an unknown distance is still offered, D2).
export async function estimatesBeforeWave(
  run: WithFirm,
  firmId: string,
  shiftId: string,
  deps: EstimateDeps = workerDeps(),
  logger: Logger = log,
): Promise<void> {
  try {
    await fillEstimates(run, firmId, { shiftIds: [shiftId] }, deps);
  } catch (error) {
    logger.warn("travel estimates before a wave failed", { firmId, shiftId, error });
  }
}

// --- the nightly run ---

export const TRAVEL_ESTIMATES_TICK_QUEUE = "travel.estimates-tick";
export const TRAVEL_ESTIMATES_CRON = "20 2 * * *"; // 02:20
export const TRAVEL_ESTIMATES_TZ = "Europe/London";

// One window job per firm per firm-local day (a second tick that day queues nothing new); one
// firm's failure never stops the others.
export async function runTravelEstimatesTick(deps: {
  listFirmIds?: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}): Promise<number> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  let queued = 0;
  for (const firmId of await (deps.listFirmIds ?? listFirmIds)()) {
    try {
      const id = await deps.run(firmId, async (tx) => {
        const [firm] = await tx
          .select({ timezone: firms.timezone })
          .from(firms)
          .where(eq(firms.id, firmId));
        if (!firm) return null;
        const day = localDateOf(now, firm.timezone);
        return queueWindowEstimates(tx, day, {
          singletonKey: `travel-estimates-window:${day}`,
          singletonSeconds: 24 * 60 * 60,
        });
      });
      if (id !== null) queued += 1;
    } catch (error) {
      logger.error("travel estimates tick failed for a firm", { firmId, error });
    }
  }
  return queued;
}
