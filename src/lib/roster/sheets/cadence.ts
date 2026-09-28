import { and, gt, lt, ne, sql } from "drizzle-orm";
import { MINUTE } from "../../auth/clock";
import { shifts } from "../../db/schema";
import type { FirmTx } from "../../db/scoped";

// How often a firm's sheet is synced (PLAN.md Phase 2): every minute on event days, every 15
// minutes otherwise. The tick runs every minute; a little slack keeps a sync that finished a few
// seconds late from slipping to every other tick. While syncs are failing (last_error_code set),
// retries back off to every 5 minutes on event days, 30 otherwise: a sheet that isn't shared
// shouldn't cost a Google call and an event row every minute.

export const EVENT_DAY_EVERY_MS = MINUTE;
export const QUIET_EVERY_MS = 15 * MINUTE;
export const FAILING_EVENT_DAY_EVERY_MS = 5 * MINUTE;
export const FAILING_QUIET_EVERY_MS = 30 * MINUTE;
const SLACK_MS = 10_000;

export function sheetsSyncDue(input: {
  lastSyncedAt: Date | null;
  lastAttemptedAt: Date | null;
  failing: boolean;
  now: Date;
  eventDay: boolean;
}): boolean {
  const since = (d: Date) => input.now.getTime() - d.getTime();
  if (input.failing && input.lastAttemptedAt) {
    const every = input.eventDay ? FAILING_EVENT_DAY_EVERY_MS : FAILING_QUIET_EVERY_MS;
    return since(input.lastAttemptedAt) >= every - SLACK_MS;
  }
  if (!input.lastSyncedAt) return true;
  const every = input.eventDay ? EVENT_DAY_EVERY_MS : QUIET_EVERY_MS;
  return since(input.lastSyncedAt) >= every - SLACK_MS;
}

// An event day: a shift that isn't cancelled is on now, finished in the last 6 hours, or starts
// in the next 24 (inside the current firm's transaction).
export async function isEventDay(tx: FirmTx, now: Date): Promise<boolean> {
  const soon = new Date(now.getTime() + 24 * 60 * MINUTE);
  const lately = new Date(now.getTime() - 6 * 60 * MINUTE);
  const [hit] = await tx
    .select({ one: sql<number>`1` })
    .from(shifts)
    .where(
      and(ne(shifts.status, "cancelled"), lt(shifts.startsAt, soon), gt(shifts.endsAt, lately)),
    )
    .limit(1);
  return hit !== undefined;
}
