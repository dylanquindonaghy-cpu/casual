import { and, eq, isNotNull } from "drizzle-orm";
import { assignments } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// "Still coming?" answers (assignments.still_coming_at, Phase 28.2 and 28.14) are for the time and
// place she saw. When a booked session's times or site change (the office, the planner, a
// connector or the rota sheet), every answer on it is cleared in the same transaction: the
// dashboard's Coming up goes back to "Not answered yet" and her card offers "Yes, I'm coming" again
// for the new time. Returns the assignment ids whose answer was cleared, so the move's event can
// say so (stillComingCleared on shift.moved / shift.curtailed). No event of its own.
export async function clearStillComing(tx: FirmTx, shiftId: string): Promise<Set<string>> {
  const cleared = await tx
    .update(assignments)
    .set({ stillComingAt: null })
    .where(and(eq(assignments.shiftId, shiftId), isNotNull(assignments.stillComingAt)))
    .returning({ id: assignments.id });
  return new Set(cleared.map((r) => r.id));
}
