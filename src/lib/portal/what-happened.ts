import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { assignments, requests } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { MAX_WHAT_HAPPENED, type WhatHappenedOutcome } from "./cancel-reasons";
import type { PortalContext } from "./my-shifts";
import { reviewPayloadSchema } from "./request-kinds";
import { refOf } from "./shift-detail";

// "If something stopped you, tell us what happened." on the cancel step's done screen
// (docs/office-v2.md 3.5, 4.5; 12C.1): the casual's own account of a cancellation they made, sent
// to the office as a `review` request (an existing request type, no new columns) about that
// shift, its payload naming the cancelled booking's reference. One waiting at a time per
// booking: sending again gives the waiting one's reference. Their words stay on the request
// (which the retention purge clears in time), never in the log: request.created holds ids and
// the type only. It changes no strike: the office decides (withdrawing one is on the Strikes page,
// 12C.5). Server only.

const noteSchema = z.string().trim().min(1).max(MAX_WHAT_HAPPENED);

export async function tellWhatHappened(
  ctx: PortalContext & { firm: { id: string } },
  workerId: string,
  shiftId: string,
  rawNote: string,
): Promise<WhatHappenedOutcome> {
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return { status: "invalid" };
  if (!z.uuid().safeParse(shiftId).success) return { status: "not_cancelled" };
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    // Their latest own cancellation on this shift, locked: two taps can't both send one.
    const [booking] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          eq(assignments.status, "cancelled_worker"),
        ),
      )
      .orderBy(desc(assignments.cancelledAt))
      .limit(1)
      .for("no key update");
    if (!booking) return { status: "not_cancelled" as const };
    const cancellation = refOf(booking.id);
    const [waiting] = await tx
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.workerId, workerId),
          eq(requests.shiftId, shiftId),
          eq(requests.type, "review"),
          inArray(requests.status, ["open", "escalated"]),
          sql`${requests.payload} ->> 'cancellation' = ${cancellation}`,
        ),
      )
      .limit(1);
    if (waiting) return { status: "already_sent" as const, ref: refOf(waiting.id) };
    const payload = reviewPayloadSchema.parse({
      codes: [],
      reasons: [],
      note: note.data,
      cancellation,
    });
    const [created] = await tx
      .insert(requests)
      .values({ firmId: ctx.firm.id, workerId, shiftId, type: "review", payload })
      .returning({ id: requests.id });
    if (!created) throw new Error("request insert returned nothing");
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "request.created",
      entityType: "request",
      entityId: created.id,
      data: { type: "review", shiftId, assignmentId: booking.id },
    });
    return { status: "sent" as const, ref: refOf(created.id) };
  });
}
