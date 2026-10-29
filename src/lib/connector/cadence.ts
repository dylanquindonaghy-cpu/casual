import { HOUR, MINUTE } from "../auth/clock";

// When a connector's source is read in full (P5.4; PLAN.md P5): the reconcile pull, which catches
// whatever its webhooks missed. Two kinds:
// - near: the sessions starting in the next 48 hours, every 15 minutes (what a casual could be
//   about to work);
// - full: every session ahead and every staff record, nightly (between 02:00 and 05:00 in the
//   firm's time zone, once that night), or at once when it never has been, or after 26 hours
//   without one whatever the hour. A full pull is a near one too.
// While pulls are failing (last_error_code set), they back off to every 30 minutes, so a system
// that's down isn't asked every 15. The tick runs every minute; a little slack keeps a pull that
// finished a few seconds late from slipping to the next one. Pure.

export const NEAR_EVERY_MS = 15 * MINUTE;
export const NEAR_WINDOW_MS = 48 * HOUR;
export const FAILING_EVERY_MS = 30 * MINUTE;
export const FULL_OVERDUE_MS = 26 * HOUR;
const FULL_SOON_AGAIN_MS = 12 * HOUR; // a night's window holds one full pull
const NIGHT_FROM_HOUR = 2;
const NIGHT_UNTIL_HOUR = 5;
const SLACK_MS = 10_000;

export type PullKind = "near" | "full";

function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .find((p) => p.type === "hour")?.value;
  return Number(hour ?? "0");
}

export function connectorPullDue(input: {
  lastFullAt: Date | null; // roster_sources.last_synced_at
  lastNearAt: Date | null; // roster_sources.last_near_synced_at
  lastAttemptedAt: Date | null;
  failing: boolean;
  now: Date;
  timeZone: string;
}): PullKind | null {
  const since = (d: Date) => input.now.getTime() - d.getTime();
  if (
    input.failing &&
    input.lastAttemptedAt &&
    since(input.lastAttemptedAt) < FAILING_EVERY_MS - SLACK_MS
  ) {
    return null;
  }
  const hour = localHour(input.now, input.timeZone);
  const night = hour >= NIGHT_FROM_HOUR && hour < NIGHT_UNTIL_HOUR;
  if (
    !input.lastFullAt ||
    since(input.lastFullAt) >= FULL_OVERDUE_MS - SLACK_MS ||
    (night && since(input.lastFullAt) >= FULL_SOON_AGAIN_MS)
  ) {
    return "full";
  }
  const lastNear = [input.lastNearAt, input.lastFullAt]
    .filter((d): d is Date => d !== null)
    .reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  return since(lastNear) >= NEAR_EVERY_MS - SLACK_MS ? "near" : null;
}
