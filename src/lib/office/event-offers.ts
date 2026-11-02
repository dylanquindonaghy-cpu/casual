import { sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { bookedJoin, placeFree } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { markUrgent } from "./quick-actions";

// An event's page's main button, "Offer N open places" (Phase 26.5, evt-1): each of the event's
// sessions with a place free, open and not started, not yet urgent, is marked urgent through the
// office's own "Mark urgent" (src/lib/roster/urgent.ts setShiftUrgent: the session locked, checked
// again and logged, the offers starting from the best people, a few at a time; none while hidden
// from casuals). One session at a time, each in its own transaction, as if pressed on each.

export type OfferOpenPlacesResult =
  | { status: "offered"; sessions: number; hidden: number }
  | { status: "none" } // nothing left to offer (each open place is already being offered)
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function offerOpenPlaces(
  ctx: OfficeContext,
  eventId: string,
): Promise<OfferOpenPlacesResult> {
  if (!z.uuid().safeParse(eventId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  const found = await parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "shifts"))) return "not_allowed" as const;
    const { rows: event } = await tx.execute(
      sql`select 1 from shift_events where id = ${eventId}::uuid`,
    );
    if (event.length === 0) return "not_found" as const;
    const { rows } = await tx.execute<{ id: string }>(sql`
      select s.id::text as id from shifts s ${bookedJoin}
       where s.event_id = ${eventId}::uuid and ${placeFree(now)} and not s.is_urgent
       order by s.starts_at, s.id
    `);
    return rows.map((r) => r.id);
  });
  if (found === "not_allowed" || found === "not_found") return { status: found };
  let sessions = 0;
  let hidden = 0;
  for (const shiftId of found) {
    const r = await markUrgent(ctx, shiftId, true);
    if (r.status === "not_allowed") return { status: "not_allowed" };
    if (r.status === "marked") sessions += 1;
    if (r.status === "marked_hidden") hidden += 1;
  }
  return sessions + hidden === 0 ? { status: "none" } : { status: "offered", sessions, hidden };
}
