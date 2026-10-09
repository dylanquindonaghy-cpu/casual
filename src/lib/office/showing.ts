import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, shiftEvents, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { startOfferWaves } from "../offers/waves";
import { officeCanPlace } from "../roster/book";
import { parts, type OfficeContext } from "./office-context";

// The event and session switches (docs/office-v2.md 3.3, "What a switch does"): whether casuals see
// an event's sessions, or one session (src/lib/roster/visibility.ts reads both). ShiftDesk's own
// setting: the sheet sync, the file import and the planner never read or write it. Active admins and
// resourcers only. Hiding never touches a booking: booked casuals keep their shifts, and the office
// can still assign. Logged `event.shown` / `event.hidden` (about the event) or `session.shown` /
// `session.hidden` (about the shift), as the office user who did it; no change, no entry.
//
// Showing again starts offers for each session it brings back that is urgent, open, not started and
// has a place free (startOfferWaves: nobody already offered it is offered again), as marking it
// urgent would have.
//
// Locks: the event row (switching an event) or the shift row (switching a session), and nothing
// else before them, so a booking or an offer that read the switch on finishes first (they hold the
// shift, then share the event: src/lib/roster/book.ts).

export const setShowingSchema = z.strictObject({
  target: z.enum(["event", "session"]),
  id: z.string(),
  showing: z.boolean(),
});
export type SetShowingInput = z.input<typeof setShowingSchema>;

export type SetShowingResult =
  | { status: "shown"; offering: number } // sessions whose offers started again
  | { status: "hidden" }
  | { status: "unchanged" }
  | { status: "not_found" }
  | { status: "not_allowed" }; // not an active admin or resourcer

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

// The sessions to offer out again once shown: shown to casuals now (both switches), urgent, open,
// not started, with a place free. Soonest first.
async function urgentGapsShown(
  tx: FirmTx,
  where: { eventId: string } | { shiftId: string },
  now: Date,
): Promise<string[]> {
  const which =
    "eventId" in where ? sql`s.event_id = ${where.eventId}` : sql`s.id = ${where.shiftId}`;
  const { rows } = await tx.execute<{ id: string }>(sql`
    select s.id from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where ${which}
       and s.showing_to_casuals and e.showing_to_casuals
       and s.is_urgent and s.status = 'open' and s.starts_at > ${now}
       and (select count(*) from assignments a
             where a.shift_id = s.id and a.worker_id is not null
               and a.status not in (${CANCELLED}) and a.slot <= s.headcount) < s.headcount
     order by s.starts_at, s.id
  `);
  return rows.map((r) => r.id);
}

export async function setShowing(
  ctx: OfficeContext,
  raw: SetShowingInput,
): Promise<SetShowingResult> {
  const input = setShowingSchema.parse(raw);
  if (!z.uuid().safeParse(input.id).success) return { status: "not_found" };
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeCanPlace(tx, ctx.officeUserId))) return { status: "not_allowed" };
    const isEvent = input.target === "event";
    const [current] = isEvent
      ? await tx
          .select({ showing: shiftEvents.showingToCasuals })
          .from(shiftEvents)
          .where(eq(shiftEvents.id, input.id))
          .for("no key update")
      : await tx
          .select({ showing: shifts.showingToCasuals })
          .from(shifts)
          .where(eq(shifts.id, input.id))
          .for("no key update");
    if (!current) return { status: "not_found" };
    if (current.showing === input.showing) return { status: "unchanged" };
    if (isEvent) {
      await tx
        .update(shiftEvents)
        .set({ showingToCasuals: input.showing })
        .where(eq(shiftEvents.id, input.id));
    } else {
      await tx
        .update(shifts)
        .set({ showingToCasuals: input.showing })
        .where(eq(shifts.id, input.id));
    }
    let offering = 0;
    if (input.showing) {
      const gaps = await urgentGapsShown(
        tx,
        isEvent ? { eventId: input.id } : { shiftId: input.id },
        now,
      );
      for (const shiftId of gaps) {
        if (await startOfferWaves(tx, { shiftId, now })) offering += 1;
      }
    }
    // Written out in full, so the action log's test finds every kind (office.log-types.test.ts).
    const action = isEvent
      ? input.showing
        ? "event.shown"
        : "event.hidden"
      : input.showing
        ? "session.shown"
        : "session.hidden";
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action,
      entityType: isEvent ? "shift_event" : "shift",
      entityId: input.id,
      data: { by: "firm", ...(offering > 0 ? { offersStarted: offering } : {}) },
    });
    return input.showing ? { status: "shown", offering } : { status: "hidden" };
  });
}
