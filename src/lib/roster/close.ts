import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { CANCELLED_ASSIGNMENT_STATUSES, shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { closeOpenOffers } from "../offers/close";
import { startOfferWaves } from "../offers/waves";
import { officeCanPlace } from "./book";
import { refreshShiftStatus } from "./native";

// The office's "Mark as filled" and "Open it again" (docs/screens.md, Today's quick actions).
//
// - closeShift: the office filled the free places another way (someone rang in, an agency), so
//   nobody else should be offered it. The shift's status becomes `filled` with places still free;
//   booking refuses it, the boards leave it out, and offer waves and escalation stop (waves.ts).
//   Unanswered offers become "filled elsewhere" (or "accepted" for someone the office placed on it).
//   Logged shift.closed {placesLeft}. Nobody booked is
//   affected, so no notice hours (golden rule 12 is for workers on the shift).
// - reopenShift: the undo. The status goes back to what its places say (open while any is free).
//   Logged shift.reopened. An urgent shift's offer waves start again.
//
// Active admins and resourcers only. A shift from a Google Sheet is changed in the sheet (the next
// sync would put the sheet's status back). A booked worker cancelling a closed shift reopens it as
// usual (native.ts): that's a new gap.

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));
const uuid = z.uuid();

export const closeShiftRequestSchema = z.strictObject({
  shiftId: z.string(),
  by: z.strictObject({ type: z.literal("office"), id: z.uuid() }),
});

export type CloseShiftResult =
  | { status: "closed"; placesLeft: number }
  | { status: "reopened"; placesLeft: number }
  | { status: "unchanged" } // already closed (or full), or already open
  | { status: "not_found" }
  | { status: "not_open" } // a draft, cancelled, or started
  | { status: "sheet" } // change it in the Google Sheet
  | { status: "not_allowed" };

async function lockForOffice(tx: FirmTx, shiftId: string) {
  const [shift] = await tx
    .select({
      status: shifts.status,
      startsAt: shifts.startsAt,
      headcount: shifts.headcount,
      source: shifts.source,
      isUrgent: shifts.isUrgent,
    })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  if (!shift) return null;
  const { rows } = await tx.execute<{ taken: number }>(sql`
    select count(*)::int as taken from assignments
     where shift_id = ${shiftId} and worker_id is not null
       and status not in (${CANCELLED}) and slot <= ${shift.headcount}
  `);
  return { ...shift, placesLeft: Math.max(0, shift.headcount - (rows[0]?.taken ?? 0)) };
}

export async function closeShift(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof closeShiftRequestSchema>,
  deps: { clock?: Clock } = {},
): Promise<CloseShiftResult> {
  const request = closeShiftRequestSchema.parse(raw);
  if (!uuid.safeParse(request.shiftId).success) return { status: "not_found" };
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx) => {
    if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
    const shift = await lockForOffice(tx, request.shiftId);
    if (!shift) return { status: "not_found" };
    if (shift.source === "sheets") return { status: "sheet" };
    if (shift.status === "filled") return { status: "unchanged" };
    if (shift.status !== "open" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    await tx.update(shifts).set({ status: "filled" }).where(eq(shifts.id, request.shiftId));
    // Offered workers who hold a place (the office placed them) took it; the rest were filled by
    // someone else (src/lib/offers/close.ts).
    await closeOpenOffers(tx, request.shiftId, now);
    await recordEvent(tx, {
      actorType: "office",
      actorId: request.by.id,
      action: "shift.closed",
      entityType: "shift",
      entityId: request.shiftId,
      data: { by: "firm", placesLeft: shift.placesLeft },
    });
    return { status: "closed", placesLeft: shift.placesLeft };
  });
}

export async function reopenShift(
  run: WithFirm,
  firmId: string,
  raw: z.input<typeof closeShiftRequestSchema>,
  deps: { clock?: Clock } = {},
): Promise<CloseShiftResult> {
  const request = closeShiftRequestSchema.parse(raw);
  if (!uuid.safeParse(request.shiftId).success) return { status: "not_found" };
  const now = (deps.clock ?? systemClock).now();
  return run(firmId, async (tx) => {
    if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
    const shift = await lockForOffice(tx, request.shiftId);
    if (!shift) return { status: "not_found" };
    if (shift.source === "sheets") return { status: "sheet" };
    // Only a shift closed with places free: a full one is filled by its bookings.
    if (shift.status === "open" || (shift.status === "filled" && shift.placesLeft === 0)) {
      return { status: "unchanged" };
    }
    if (shift.status !== "filled" || shift.startsAt.getTime() <= now.getTime()) {
      return { status: "not_open" };
    }
    await refreshShiftStatus(tx, request.shiftId, now);
    // An urgent shift's offers start again (a wave now, the escalation for later).
    if (shift.isUrgent) await startOfferWaves(tx, { shiftId: request.shiftId, now });
    await recordEvent(tx, {
      actorType: "office",
      actorId: request.by.id,
      action: "shift.reopened",
      entityType: "shift",
      entityId: request.shiftId,
      data: { by: "firm", placesLeft: shift.placesLeft },
    });
    return { status: "reopened", placesLeft: shift.placesLeft };
  });
}
