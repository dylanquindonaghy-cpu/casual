import { sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import type { FirmTx } from "../db/scoped";
import { offerShiftPlaces, type OfferPlacesResult } from "../roster/urgent";
import { urgentWindowHours } from "../rules/urgent";
import { bookedJoin, placeFree } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// An event's page's offers (Phase 26.5, evt-1 and evt-4), each session through one locked step
// (src/lib/roster/urgent.ts offerShiftPlaces: open, not started, a place free, its offers not
// already going out; marked urgent, or its stopped offers started again; logged):
// - "Offer to the best …" on one open place: that session.
// - "Offer N open places": each of the event's sessions starting within the firm's urgent window
//   (`urgent_window_hours`, 24 by default) with a place free and no offers going out, one at a
//   time. Urgent offers aren't held to a casual's daily limit, so one press never offers a whole
//   event days ahead to the same few people (the guardrails review; a decision for Dylan,
//   docs/plan/decisions-waiting.md): a place further ahead is offered from its own card.

export function offerOnePlace(ctx: OfficeContext, shiftId: string): Promise<OfferPlacesResult> {
  const { run, by } = parts(ctx);
  return offerShiftPlaces(run, ctx.firm.id, { shiftId, by }, ctx.clock ? { clock: ctx.clock } : {});
}

export type OfferOpenPlacesResult =
  | { status: "offered"; sessions: number; hidden: number }
  | { status: "none" } // nothing in the window left to offer
  | { status: "not_found" }
  | { status: "not_allowed" };

// The sessions "Offer N open places" would offer now, and their free places (the button's N).
export async function openPlacesInWindow(
  tx: FirmTx,
  eventId: string,
  now: Date,
): Promise<{ shiftId: string; free: number }[]> {
  const { rows: firm } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`select settings from firms where id = app_current_firm_id()`,
  );
  const hours = urgentWindowHours(firm[0]?.settings ?? {});
  const { rows } = await tx.execute<{ id: string; free: number; live: boolean }>(sql`
    select s.id::text as id, (s.headcount - b.booked)::int as free,
           (s.is_urgent and not coalesce(
              (select (e.data ->> 'wave')::int from events e
                where e.entity_id = s.id and e.action = 'offer.waves_stopped'
                order by e.id desc limit 1)
              > coalesce((select max(o.wave) from offers o where o.shift_id = s.id), 0),
              false)) as live
      from shifts s ${bookedJoin}
     where s.event_id = ${eventId}::uuid and ${placeFree(now)}
       and s.starts_at <= ${new Date(now.getTime() + hours * 3_600_000)}
     order by s.starts_at, s.id
  `);
  return rows.filter((r) => !r.live).map((r) => ({ shiftId: r.id, free: r.free }));
}

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
    return openPlacesInWindow(tx, eventId, now);
  });
  if (found === "not_allowed" || found === "not_found") return { status: found };
  let sessions = 0;
  let hidden = 0;
  for (const { shiftId } of found) {
    const r = await offerOnePlace(ctx, shiftId);
    if (r.status === "not_allowed") return { status: "not_allowed" };
    if (r.status === "offering") sessions += 1;
    if (r.status === "offering_hidden") hidden += 1;
  }
  return sessions + hidden === 0 ? { status: "none" } : { status: "offered", sessions, hidden };
}
