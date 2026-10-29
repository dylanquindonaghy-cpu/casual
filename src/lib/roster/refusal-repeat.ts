import { and, desc, eq } from "drizzle-orm";
import { events } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Whether a refusal on a session says exactly what its last one of the same kind said (P5.4's
// review): a connector's source is read every 15 minutes, so a change the rules keep refusing
// would otherwise be logged again at every read. Only a connector's refusals are skipped this
// way (the callers check): a planner's or the office's own attempts are each logged.

// JSON with every object's keys in order (jsonb reorders them on the way in).
function canon(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, w]) => [k, sorted(w)]),
          )
        : v;
  return JSON.stringify(sorted(value));
}

export async function sameAsLastRefusal(
  tx: FirmTx,
  shiftId: string,
  action: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const [last] = await tx
    .select({ data: events.data })
    .from(events)
    .where(
      and(eq(events.entityType, "shift"), eq(events.entityId, shiftId), eq(events.action, action)),
    )
    .orderBy(desc(events.id))
    .limit(1);
  return last !== undefined && canon(last.data) === canon(data);
}
