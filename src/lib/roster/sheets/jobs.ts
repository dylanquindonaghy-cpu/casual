import { and, eq } from "drizzle-orm";
import { systemClock, type Clock } from "../../auth/clock";
import { rosterSources } from "../../db/schema";
import type { WithFirm } from "../../db/scoped";
import {
  firmJobEnvelope,
  sendFirmJob,
  type FirmJobEnvelope,
  type FirmTask,
} from "../../jobs/firm-job";
import { log, type Logger } from "../../log";
import { isEventDay, sheetsSyncDue } from "./cadence";
import type { SheetsClient } from "./client";
import { syncSheet } from "./sync";

// The Sheets jobs (docs/api-and-jobs.md):
// - sheets-sync-tick: a cron every minute (no firm). Visits each firm; a firm with an enabled
//   sheet that is due (cadence.ts) gets one sheets-sync job.
// - sheets-sync: one firm's sync (sync.ts). A FirmTask, because it calls Google between its
//   transactions. At most one per firm per minute of the tick's own clock (a firm-scoped
//   singleton key holding that minute), and the sync's lease stops two from overlapping.

export const SHEETS_SYNC_QUEUE = "sheets-sync";
export const SHEETS_TICK_QUEUE = "sheets-sync-tick";
export const SHEETS_TICK_CRON = "* * * * *";
// pg-boss gives up on a job after this long, before the sync's own 5-minute lease runs out, so a
// stuck sync is never still running when the next one takes the lease (sync.ts SYNC_LEASE_MS).
export const SHEETS_SYNC_EXPIRE_SECONDS = 4 * 60;
// pg-boss also puts each singleton in a time slot of the database's own clock (job_now()). With a
// short slot, two ticks a moment apart could fall either side of a slot edge and both queue, so
// the slot is pg-boss's largest (one slot from 1970 to 2038) and the key, which holds the tick's
// minute, alone decides.
const SYNC_SINGLETON_SECONDS = 2_147_483_647;

export const sheetsSyncJob = { queue: SHEETS_SYNC_QUEUE, schema: firmJobEnvelope };

export function sheetsSyncTask(
  client: SheetsClient,
  clock: Clock = systemClock,
): FirmTask<FirmJobEnvelope> {
  return {
    ...sheetsSyncJob,
    task: (payload, run) => syncSheet({ run, firmId: payload.firmId, client, clock }),
  };
}

export interface TickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  clock?: Clock;
  logger?: Logger;
}

// One firm's failure (say its row is locked) never stops the others' syncs.
export async function runSheetsTick(deps: TickDeps): Promise<{ queued: number }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const minute = Math.floor(now.getTime() / 60_000);
  let queued = 0;
  for (const firmId of await deps.listFirmIds()) {
    try {
      const sent = await deps.run(firmId, async (tx) => {
        const [source] = await tx
          .select({
            lastSyncedAt: rosterSources.lastSyncedAt,
            lastAttemptedAt: rosterSources.lastAttemptedAt,
            lastErrorCode: rosterSources.lastErrorCode,
          })
          .from(rosterSources)
          .where(and(eq(rosterSources.kind, "sheets"), eq(rosterSources.enabled, true)));
        if (!source) return false;
        const eventDay = await isEventDay(tx, now);
        const due = sheetsSyncDue({
          lastSyncedAt: source.lastSyncedAt,
          lastAttemptedAt: source.lastAttemptedAt,
          failing: source.lastErrorCode !== null,
          now,
          eventDay,
        });
        if (!due) return false;
        const key = `sheets-sync:${minute}`;
        const id = await sendFirmJob(
          tx,
          sheetsSyncJob,
          { idempotencyKey: key },
          { singletonKey: key, singletonSeconds: SYNC_SINGLETON_SECONDS },
        );
        return id !== null;
      });
      if (sent) queued += 1;
    } catch (err) {
      logger.error("sheets tick failed for a firm", { firmId, error: err });
    }
  }
  return { queued };
}
