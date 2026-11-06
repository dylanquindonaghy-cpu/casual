import { and, eq, gt, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { HOUR, systemClock } from "../auth/clock";
import { assignments, shifts } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import type { PortalContext } from "./my-shifts";

// "Still coming?" (Phase 28.2; 28.14 shows it): in the day before a booked session, the casual
// taps "Yes, I'm coming". One conditional UPDATE sets assignments.still_coming_at, only on her own
// confirmed booking of a session that isn't cancelled, starts within STILL_COMING_HOURS and hasn't
// started, and only once (still_coming_at null). Zero rows changes nothing: "already" when she said
// so before, "not_now" otherwise (not hers, cancelled, too early or started). The change and
// shift.still_coming ({assignmentId, shiftId, workerId}: ids only) go in together.
//
// Shown to the office to plan cover, nothing more (docs/compliance.md): no reliability figure,
// offer wave, strike or Watch list reads it (tests/unit/rules.p28-boundary.test.ts), and not
// answering has no effect at all.

export const STILL_COMING_HOURS = 24;

export type StillComingOutcome =
  | { status: "confirmed"; at: Date }
  | { status: "already"; at: Date } // she said so before
  | { status: "not_now" } // not her confirmed booking, cancelled, more than a day away, or started
  | { status: "logged_out" }
  | { status: "error" };

const uuid = z.uuid();

export async function confirmStillComing(
  ctx: PortalContext,
  workerId: string,
  shiftId: string,
): Promise<StillComingOutcome> {
  if (!uuid.safeParse(shiftId).success || !uuid.safeParse(workerId).success) {
    return { status: "not_now" };
  }
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const until = new Date(now.getTime() + STILL_COMING_HOURS * HOUR);
  return run(ctx.firm.id, async (tx): Promise<StillComingOutcome> => {
    const [said] = await tx
      .update(assignments)
      .set({ stillComingAt: now })
      .from(shifts)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
          isNull(assignments.stillComingAt),
          eq(shifts.firmId, assignments.firmId),
          eq(shifts.id, assignments.shiftId),
          ne(shifts.status, "cancelled"),
          gt(shifts.startsAt, now),
          lte(shifts.startsAt, until),
        ),
      )
      .returning({ id: assignments.id });
    if (said) {
      await recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action: "shift.still_coming",
        entityType: "assignment",
        entityId: said.id,
        data: { assignmentId: said.id, shiftId, workerId },
      });
      return { status: "confirmed", at: now };
    }
    const [before] = await tx
      .select({ at: assignments.stillComingAt })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
          isNotNull(assignments.stillComingAt),
        ),
      );
    return before?.at ? { status: "already", at: before.at } : { status: "not_now" };
  });
}
