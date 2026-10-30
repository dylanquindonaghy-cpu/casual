import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";

// Whether a connector's refusal on a session says exactly what is already standing for it (P5.4's
// review): its source is read every 15 minutes, so a change the rules keep refusing would
// otherwise be logged again at every read. It stands while it's the session's latest planner
// refusal (shift.move_refused or api.change_refused, either) and nothing logged since would have
// cleared it from Needs attention: the same conditions as loadPlannerRefusals()
// (src/lib/office/dashboard.ts), so the office always sees a refusal that's still live. Only a
// connector's refusals are skipped this way (the callers check): a planner's or the office's own
// attempts are each logged. The refusal's data carries a fingerprint of what was attempted
// (refusalAttempt), so a different change refused for the same reason is logged too.

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

// What a connector asked for, as a short fingerprint (the session's fields only: nothing personal).
export function refusalAttempt(body: unknown): string {
  return createHash("sha256").update(canon(body)).digest("hex").slice(0, 16);
}

export async function sameAsLastRefusal(
  tx: FirmTx,
  shiftId: string,
  action: "api.change_refused" | "shift.move_refused",
  data: Record<string, unknown>,
): Promise<boolean> {
  const { rows } = await tx.execute<{ id: number; action: string; data: unknown }>(sql`
    select e.id, e.action, e.data from events e
     where e.firm_id = app_current_firm_id() and e.entity_id = ${shiftId}
       and e.data ->> 'via' = 'api'
       and e.action in ('shift.move_refused', 'api.change_refused')
     order by e.id desc
     limit 1
  `);
  const last = rows[0];
  if (!last || last.action !== action || canon(last.data) !== canon(data)) return false;
  const { rows: cleared } = await tx.execute(sql`
    select 1 from events c
     where c.firm_id = app_current_firm_id() and c.entity_id = ${shiftId} and c.id > ${last.id}
       and c.action in ('shift.changed', 'shift.cancelled_by_firm')
    union all
    select 1 from assignments a
      join events c on c.firm_id = a.firm_id and c.entity_id = a.id
     where a.firm_id = app_current_firm_id() and a.shift_id = ${shiftId} and c.id > ${last.id}
       and c.action in ('shift.moved', 'shift.curtailed', 'shift.cancelled')
     limit 1
  `);
  return cleared.length === 0;
}
