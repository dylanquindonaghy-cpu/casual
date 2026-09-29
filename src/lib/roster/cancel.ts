import { eq } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace, plugFor, rosterId } from "./book";
import type { CancelResult } from "./plug";
import { markUrgentAfterDropout } from "./urgent";

// Cancelling a booking: the one path for a worker cancelling their own shift, or the office
// cancelling someone's (golden rules 5 and 12; docs/architecture.md, "Cancel"). In its own
// transaction (a deadlock retries it, twice at most):
//   1. who may cancel whom: a worker only their own booking, and not once the shift has started
//      (that's a conversation with the office); the office only as an active admin or resourcer,
//      and not once the shift has ended (no-shows and completed shifts are Phase 5);
//   2. the plug's markCancelled: locks the shift, frees the place (reopened only while the shift
//      hasn't started), and stores on the assignment row who cancelled, why, when and the notice
//      hours (shift start minus now);
//   3. the shift.cancelled event, in the same transaction.
// The reason is typed by a person and may name someone or mention their health, so it is kept
// only on the assignment row (which can be corrected or anonymised), never in the action log
// (which is append-only): the event carries who, which shift and booking, and the notice hours.
// No fresh copy of a firm's sheet is needed: a Sheets shift's cancellation counts at once, and the
// next sync takes the name out. `now` is taken once, so a retry never moves the notice hours.

export const cancelRequestSchema = z.strictObject({
  shiftId: rosterId,
  workerId: rosterId,
  reason: z.string().trim().min(1).max(500),
  by: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("worker"), id: rosterId }),
    z.strictObject({ type: z.literal("office"), id: rosterId }),
  ]),
});
export type CancelRequest = z.input<typeof cancelRequestSchema>;

export type CancelBookingResult =
  | CancelResult
  // A worker asking after the shift started: the office handles it.
  | { status: "started" }
  // The office asking after the shift ended: that's a no-show or a completed shift (Phase 5).
  | { status: "ended" }
  // The office user can't cancel staff (disabled, or payroll).
  | { status: "not_allowed" };

export async function cancelBooking(
  run: WithFirm,
  firmId: string,
  raw: CancelRequest,
  deps: { clock?: Clock } = {},
): Promise<CancelBookingResult> {
  const request = cancelRequestSchema.parse(raw);
  if (request.by.type === "worker" && request.by.id !== request.workerId) {
    throw new Error("a worker can only cancel their own booking");
  }
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() => run(firmId, (tx) => cancelInTransaction(tx, request, now)));
}

async function cancelInTransaction(
  tx: FirmTx,
  request: z.output<typeof cancelRequestSchema>,
  now: Date,
): Promise<CancelBookingResult> {
  const { shiftId, workerId, reason, by } = request;
  if (by.type === "office" && !(await officeCanPlace(tx, by.id))) return { status: "not_allowed" };
  // Locked (the same shift-first order as every booking), so its times can't change before the
  // plug's own lock.
  const [shift] = await tx
    .select({ source: shifts.source, startsAt: shifts.startsAt, endsAt: shifts.endsAt })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  if (!shift) return { status: "not_found" };
  if (by.type === "worker" && shift.startsAt.getTime() <= now.getTime()) {
    return { status: "started" };
  }
  if (shift.endsAt.getTime() <= now.getTime()) return { status: "ended" };

  const cancelled = await plugFor(tx, shift.source, now).markCancelled(shiftId, workerId, {
    reason,
    by: by.type === "worker" ? "worker" : "firm",
    at: now,
  });
  if (cancelled.status !== "cancelled") return cancelled;

  await recordEvent(tx, {
    actorType: by.type,
    actorId: by.id,
    action: "shift.cancelled",
    entityType: "assignment",
    entityId: cancelled.assignmentId,
    data: {
      by: by.type === "worker" ? "worker" : "firm",
      shiftId,
      workerId,
      noticeHours: cancelled.noticeHours,
    },
  });
  // A place reopened close to the start: the shift is urgent (golden rule 5: logged too).
  await markUrgentAfterDropout(tx, { shiftId, now });
  return cancelled;
}
