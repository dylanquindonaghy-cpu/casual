import { eq, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { listFirmIds } from "../db/directory";
import { firms, sites, travelEstimates, type EstimateMode } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import type { FirmTask } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import { localDateOf } from "../time/zoned";
import {
  ARRIVE_BEFORE_MINUTES,
  ESTIMATE_KEEP_DAYS,
  JOB_WINDOW_DAYS,
  queueMoreWindow,
  queueTravelEstimates,
  queueWindowEstimates,
  TRAVEL_ESTIMATES_QUEUE,
  travelEstimatesPayload,
  type TravelEstimatesPayload,
} from "./estimate-queue";
import type { Point } from "./geocoder";
import { SEARCH_MAX_ORIGINS, type SearchResult, type TravelProvider, type Trip } from "./provider";
import { workerTravelProvider } from "./worker-provider";

// The travel job (docs/office-v2.md 5.4; 12G.2): fills in the travel estimates sessions are missing.
// Worker only; a page never calls the provider.
//
// - Which sessions: the ones asked for, or every one in the window (the nightly run); open or
//   booked, not started, starting within JOB_WINDOW_DAYS (the open-shifts window plus a day: the
//   nightly run covers until the next one), at a site whose point is known. A session further off
//   gets them as it comes into the window.
// - One search per site, arrive-by time (30 minutes before the start, an absolute time, so the
//   clock change can't move it) and way of travelling, car and public transport both (a casual
//   sees both times, whichever they chose). Sessions sharing a site and start share searches.
// - The start points are the distinct postcodes of active casuals with one of those sessions'
//   roles (one point per postcode: the latest saved), only those with no estimate yet from this
//   provider, in batches of SEARCH_MAX_ORIGINS. Each goes to the provider as its point under a
//   meaningless id ("o1"), never the postcode.
// - One group at a time, in short transactions that each take the site's row first (as a postcode
//   change does, so the two take turns), with no transaction open during a search. An answer is
//   saved only if the site's point is still the one searched (a postcode change meanwhile deletes
//   the site's estimates and queues new ones), expiring 7 days after the last session it's for.
// - A provider that doesn't answer stops the run (no hammering): what was saved stays, and the job
//   fails, so pg-boss tries again later; the nightly run catches up after that. A run that uses up
//   its time budget stops between searches and, if it saved anything, queues the rest as a fresh
//   run.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MODES: readonly EstimateMode[] = ["car", "public_transport"];
// One run's time budget, and the queue's expiry (src/worker/jobs/queues.ts), longer than the budget
// plus one search's timeout (10 seconds, src/lib/travel/provider.ts).
export const TRAVEL_JOB_BUDGET_MS = 10 * MINUTE;
export const TRAVEL_JOB_EXPIRE_SECONDS = 15 * 60;
// The first wave's best-effort fill: never longer than this before the offers go.
export const BEFORE_WAVE_BUDGET_MS = 5_000;

export class TravelUnavailableError extends Error {
  constructor() {
    super("the travel provider didn't answer");
    this.name = "TravelUnavailableError";
  }
}

export interface EstimateDeps {
  provider: TravelProvider;
  clock: Clock;
  // Stops between searches once this much time has gone, and stops waiting for a search that runs
  // past it ("more": the rest is for another run). Absent: no budget.
  budgetMs?: number;
}

export interface FillResult {
  searches: number;
  saved: number; // estimates added or refreshed
  unavailable: boolean; // the provider stopped answering
  more: boolean; // the budget ran out with work left
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

// The sessions' groups (by site and arrive-by), in one short read.
async function groupsFor(
  run: WithFirm,
  firmId: string,
  scope: { shiftIds: readonly string[] } | { window: true },
  now: Date,
): Promise<Group[]> {
  return run(firmId, async (tx) => {
    const which =
      "window" in scope
        ? sql`true`
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
         and s.starts_at < ${now}::timestamptz + make_interval(days => ${JOB_WINDOW_DAYS})
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
    return [...groups.values()];
  });
}

// Holds the site's row for the transaction (as a postcode change does) and checks it's still
// where it was searched. False: it moved, or went.
async function siteStill(tx: FirmTx, g: Group): Promise<boolean> {
  const [site] = await tx
    .select({ lat: sites.lat, lng: sites.lng })
    .from(sites)
    .where(eq(sites.id, g.siteId))
    .for("share");
  return !!site && Number(site.lat) === g.site.lat && Number(site.lng) === g.site.lng;
}

// One group: its existing estimates kept as long as its last session needs them, and, per way,
// the start points still missing an estimate from this provider. Null: the site has moved.
async function missingFor(
  run: WithFirm,
  firmId: string,
  g: Group,
  provider: TravelProvider["name"],
): Promise<Map<EstimateMode, Origin[]> | null> {
  return run(firmId, async (tx) => {
    if (!(await siteStill(tx, g))) return null;
    await tx.execute(sql`
      update travel_estimates set expires_at = ${g.expiresAt}
       where site_id = ${g.siteId} and arrive_by = ${g.arriveBy} and expires_at < ${g.expiresAt}
    `);
    const missing = new Map<EstimateMode, Origin[]>();
    for (const mode of MODES) {
      // One point per postcode (the latest saved: two casuals' points for one postcode can differ
      // after the look-up's data changes), so a batch never holds the same postcode twice.
      const { rows } = await tx.execute<{ postcode: string; lat: string; lng: string }>(sql`
        select distinct on (t.start_postcode) t.start_postcode as postcode,
               t.lat::text, t.lng::text
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
                              and e.origin_postcode = t.start_postcode
                              and e.provider = ${provider})
         order by t.start_postcode, t.updated_at desc, t.id
      `);
      missing.set(
        mode,
        rows.map((r) => ({
          postcode: r.postcode,
          point: { lat: Number(r.lat), lng: Number(r.lng) },
        })),
      );
    }
    return missing;
  });
}

// The provider's answer, or "late" if it hasn't come within `ms` (null: no limit): the budget ran
// out (the provider's own time limit is what says it's down).
async function within(
  search: Promise<SearchResult>,
  ms: number | null,
): Promise<SearchResult | "late"> {
  if (ms === null) return search;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), Math.max(0, ms));
  });
  try {
    return await Promise.race([search, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function save(
  run: WithFirm,
  firmId: string,
  g: Group,
  mode: EstimateMode,
  found: { postcode: string; trip: Trip }[],
  provider: TravelProvider["name"],
  now: Date,
): Promise<number> {
  return run(firmId, async (tx) => {
    // Only if the site is still where it was searched.
    if (!(await siteStill(tx, g))) return 0;
    const saved = await tx
      .insert(travelEstimates)
      .values(
        found.map((f) => ({
          firmId: sql`app_current_firm_id()`,
          originPostcode: f.postcode,
          siteId: g.siteId,
          mode,
          arriveBy: g.arriveBy,
          minutes: f.trip?.minutes ?? null,
          metres: f.trip?.metres ?? null,
          provider,
          computedAt: now,
          expiresAt: g.expiresAt,
        })),
      )
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

export async function fillEstimates(
  run: WithFirm,
  firmId: string,
  scope: { shiftIds: readonly string[] } | { window: true },
  deps: EstimateDeps,
): Promise<FillResult> {
  const now = deps.clock.now();
  const started = Date.now();
  const left = () => (deps.budgetMs === undefined ? null : deps.budgetMs - (Date.now() - started));
  const outOfTime = () => {
    const ms = left();
    return ms !== null && ms <= 0;
  };
  const result: FillResult = { searches: 0, saved: 0, unavailable: false, more: false };
  if ("shiftIds" in scope && scope.shiftIds.length === 0) return result;
  for (const group of await groupsFor(run, firmId, scope, now)) {
    if (outOfTime()) return { ...result, more: true };
    const missing = await missingFor(run, firmId, group, deps.provider.name);
    if (!missing) continue; // the site moved: its new estimates are queued with the move
    for (const mode of MODES) {
      const origins = missing.get(mode) ?? [];
      for (let i = 0; i < origins.length; i += SEARCH_MAX_ORIGINS) {
        if (outOfTime()) return { ...result, more: true };
        const batch = origins.slice(i, i + SEARCH_MAX_ORIGINS);
        const ids = batch.map((_, n) => `o${n + 1}`);
        result.searches += 1;
        const answer = await within(
          deps.provider.search({
            to: group.site,
            arriveBy: group.arriveBy,
            mode,
            from: batch.map((o, n) => ({ id: ids[n] ?? "", point: o.point })),
          }),
          left(),
        );
        if (answer === "late") return { ...result, more: true };
        if (answer.status === "unavailable") return { ...result, unavailable: true };
        const found: { postcode: string; trip: Trip }[] = [];
        batch.forEach((o, n) => {
          const id = ids[n] ?? "";
          if (answer.trips.has(id)) {
            found.push({ postcode: o.postcode, trip: answer.trips.get(id) ?? null });
          }
        });
        if (found.length > 0) {
          result.saved += await save(run, firmId, group, mode, found, deps.provider.name, now);
        }
      }
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
      const result = await fillEstimates(run, payload.firmId, scope, {
        budgetMs: TRAVEL_JOB_BUDGET_MS,
        ...deps(),
      });
      if (result.unavailable) throw new TravelUnavailableError();
      // Out of time with work left: the rest in a fresh run (it only fills what's still missing),
      // as long as this one saved something. A run that saved nothing in its whole budget would
      // only do the same again: the rest waits for the nightly run.
      if (result.more && result.saved > 0) {
        await run(payload.firmId, async (tx) => {
          if (payload.window) await queueMoreWindow(tx);
          else await queueTravelEstimates(tx, payload.shiftIds ?? [], { startAfter: 30 });
        });
      }
      return { searches: result.searches, saved: result.saved, more: result.more };
    },
  };
}

const workerDeps = (): EstimateDeps => ({ provider: workerTravelProvider(), clock: systemClock });
export const travelEstimatesTask = createTravelEstimatesTask(workerDeps);

// Before an urgent session's first wave (src/lib/offers/waves.ts): its missing estimates, so the
// travel limit (12G.3) has them. Best-effort, and never longer than BEFORE_WAVE_BUDGET_MS: a
// provider that's slow or doesn't answer never holds an offer back (an unknown distance is still
// offered, D2).
export async function estimatesBeforeWave(
  run: WithFirm,
  firmId: string,
  shiftId: string,
  deps?: EstimateDeps,
  logger: Logger = log,
): Promise<void> {
  try {
    const result = await fillEstimates(
      run,
      firmId,
      { shiftIds: [shiftId] },
      { budgetMs: BEFORE_WAVE_BUDGET_MS, ...(deps ?? workerDeps()) },
    );
    if (result.unavailable || result.more) {
      logger.warn("travel estimates before a wave not finished", {
        firmId,
        shiftId,
        unavailable: result.unavailable,
        more: result.more,
      });
    }
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
