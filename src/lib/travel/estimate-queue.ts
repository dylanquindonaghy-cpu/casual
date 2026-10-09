import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob, type FirmSendOptions } from "../jobs/firm-job";

// Queuing the travel job (docs/office-v2.md 5.4; 12G.2), inside the transaction of the change that
// needs it, so it commits or rolls back with it. Its payload carries ids only: the sessions, or
// "the window" (every session in JOB_WINDOW_DAYS: the nightly run, casuals' changes, and a run's
// leftovers). The job only works out estimates that are missing, so queuing it twice costs a
// database read, never a second search.
// Light on purpose: the web app queues it without loading the provider (src/lib/travel/
// estimates.ts runs it, in the worker).

export const TRAVEL_ESTIMATES_QUEUE = "travel.estimates";
export const ESTIMATE_JOB_MAX_SESSIONS = 200;
// The open-shifts window (src/lib/portal/open-shifts.ts OPEN_WINDOW_DAYS), repeated here so the web
// app's queuing doesn't load the portal's code; a test holds the two equal.
export const ESTIMATE_WINDOW_DAYS = 28;
// The job's window: the open-shifts window plus a day, so a session coming into the open-shifts
// window before the next nightly run already has its estimates.
export const JOB_WINDOW_DAYS = ESTIMATE_WINDOW_DAYS + 1;
// Arrive this long before a session starts (a fixed time to sign in); estimates are kept until
// this long after the last session they're for.
export const ARRIVE_BEFORE_MINUTES = 30;
export const ESTIMATE_KEEP_DAYS = 7;

export const travelEstimatesPayload = firmJobEnvelope
  .extend({
    idempotencyKey: z.string().regex(/^travel-estimates:[a-z0-9-]{1,60}$/),
    shiftIds: z.array(z.uuid()).min(1).max(ESTIMATE_JOB_MAX_SESSIONS).optional(),
    window: z.literal(true).optional(),
  })
  .refine((p) => (p.shiftIds !== undefined) !== (p.window === true), {
    message: "sessions or the window, not both",
  });
export type TravelEstimatesPayload = z.infer<typeof travelEstimatesPayload>;

const job = { queue: TRAVEL_ESTIMATES_QUEUE, schema: travelEstimatesPayload };

// These sessions' missing estimates, in jobs of at most ESTIMATE_JOB_MAX_SESSIONS. (Sessions
// outside the job's window are skipped by the job: they get theirs from the nightly run.)
export async function queueTravelEstimates(
  tx: FirmTx,
  shiftIds: readonly string[],
  options?: Pick<FirmSendOptions, "startAfter">,
): Promise<number> {
  const ids = [...new Set(shiftIds)];
  let queued = 0;
  for (let i = 0; i < ids.length; i += ESTIMATE_JOB_MAX_SESSIONS) {
    await sendFirmJob(
      tx,
      job,
      {
        idempotencyKey: `travel-estimates:${randomUUID()}`,
        shiftIds: ids.slice(i, i + ESTIMATE_JOB_MAX_SESSIONS),
      },
      options,
    );
    queued += 1;
  }
  return queued;
}

// Every session in the window: the nightly run, once a firm-local day.
export async function queueWindowEstimates(
  tx: FirmTx,
  day: string, // the firm's local date, yyyy-mm-dd
  options?: FirmSendOptions,
): Promise<string | null> {
  return sendFirmJob(
    tx,
    job,
    { idempotencyKey: `travel-estimates:window-${day}`, window: true },
    options,
  );
}

// The rest of a window run that ran out of time, as a fresh run.
export async function queueMoreWindow(tx: FirmTx): Promise<string | null> {
  return sendFirmJob(
    tx,
    job,
    { idempotencyKey: `travel-estimates:more-${randomUUID()}`, window: true },
    { startAfter: 30 },
  );
}

// Queued next to an offer wave: after the wave's own best-effort fill (estimatesBeforeWave), so the
// two don't search the same estimates at once.
export const AFTER_WAVE_DELAY_SECONDS = 120;

// Casuals' changes wait this long and share one window run: a casual saving their area three
// times, or ten casuals saving theirs, costs one run, not one each.
export const CASUAL_CHANGE_DELAY_SECONDS = 300;

// Sessions that need travel lines: open or booked, not started, in the job's window.
const needing = (now: Date) => sql`s.status in ('open', 'filled') and s.starts_at > ${now}
  and s.starts_at < ${now}::timestamptz + make_interval(days => ${JOB_WINDOW_DAYS})`;

// A site's postcode changed: its old estimates are wrong now, so they go, and every session there
// in the window gets new ones (later ones get theirs from the nightly run). Returns how many were
// deleted.
export async function siteMoved(tx: FirmTx, siteId: string, now: Date): Promise<number> {
  const { rows: gone } = await tx.execute<{ id: string }>(sql`
    delete from travel_estimates where site_id = ${siteId} returning id
  `);
  const { rows } = await tx.execute<{ id: string }>(sql`
    select s.id::text from shifts s where s.site_id = ${siteId} and ${needing(now)}
  `);
  await queueTravelEstimates(
    tx,
    rows.map((r) => r.id),
  );
  return gone.length;
}

// A casual's postcode or ways of travelling changed: a window run after CASUAL_CHANGE_DELAY_SECONDS,
// shared with every other casual change in the meantime (one queued run per firm per slot; a
// second change in the slot is already covered, since the run reads the areas when it starts).
export async function casualMoved(tx: FirmTx): Promise<string | null> {
  return sendFirmJob(
    tx,
    job,
    { idempotencyKey: `travel-estimates:casuals-${randomUUID()}`, window: true },
    {
      startAfter: CASUAL_CHANGE_DELAY_SECONDS,
      singletonKey: "travel-estimates-casuals",
      singletonSeconds: CASUAL_CHANGE_DELAY_SECONDS,
    },
  );
}
