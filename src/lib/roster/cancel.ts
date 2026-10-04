import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { assignments, offers, shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace, plugFor, rosterId } from "./book";
import type { CancelResult } from "./plug";
import { queueFirmChangeNotice } from "../notices/firm-change";
import { removeFreedPlace } from "./native";
import { markUrgentAfterDropout } from "./urgent";
import { FIRM_CHANGE_REASONS, SHIFT_CHANGE_REASON_CODES, firmReasonWords } from "./firm-reasons";

// Cancelling a booking: the one path for a worker cancelling their own shift, or the office
// cancelling someone's (golden rules 5 and 12; docs/architecture.md, "Cancel"). In its own
// transaction (a deadlock retries it, twice at most):
//   1. who may cancel whom: a worker only their own booking, and not once the shift has started
//      (that's a conversation with the office); the office only as an active admin or resourcer,
//      and not once the shift has ended (then it's who worked it: attendance.ts);
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
  // The office asking after the shift ended: that's a no-show or a completed shift (attendance.ts).
  | { status: "ended" }
  // The office user can't cancel staff (disabled, or payroll).
  | { status: "not_allowed" }
  // "The client needs fewer staff" takes the place away, which can't be done for a shift's last
  // place (that's cancelling the shift) or a rota sheet's shift (the sheet sets its places).
  // Refused, so the place isn't left open for someone else to take; nothing is changed.
  | { status: "keeps_place"; why: "last_place" | "sheet" }
  // A "fewer staff" cancellation: the shift needs this many now.
  | (CancelResult & { status: "cancelled"; placesNow?: number });

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
    .select({
      source: shifts.source,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      headcount: shifts.headcount,
    })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  if (!shift) return { status: "not_found" };
  if (by.type === "worker" && shift.startsAt.getTime() <= now.getTime()) {
    return { status: "started" };
  }
  if (shift.endsAt.getTime() <= now.getTime()) return { status: "ended" };
  const fewerStaff = by.type === "office" && reason === FIRM_CHANGE_REASONS.fewer_staff;
  if (fewerStaff && shift.source === "sheets") return { status: "keeps_place", why: "sheet" };
  if (fewerStaff && shift.headcount <= 1) return { status: "keeps_place", why: "last_place" };

  const initiator = by.type === "worker" ? "worker" : "firm";
  const cancelled = await plugFor(tx, shift.source, now).markCancelled(shiftId, workerId, {
    reason,
    by: initiator,
    at: now,
  });
  if (cancelled.status !== "cancelled") return cancelled;

  // The firm's reason is from its fixed list, so its words may go in the log; any other reason is
  // free text and stays on the row.
  const firmReason = initiator === "firm" ? firmReasonWords(reason) : null;
  const eventId = await recordEvent(tx, {
    actorType: by.type,
    actorId: by.id,
    action: "shift.cancelled",
    entityType: "assignment",
    entityId: cancelled.assignmentId,
    data: {
      by: initiator,
      shiftId,
      workerId,
      noticeHours: cancelled.noticeHours,
      ...(firmReason ? { reason: firmReason } : {}),
    },
  });
  // The firm cancelled someone's booking: they're told (golden rule 12).
  if (initiator === "firm") {
    await queueFirmChangeNotice(tx, { eventId, assignmentId: cancelled.assignmentId });
  }
  // The client needs fewer staff: the place goes rather than being offered to someone else, who
  // might then need cancelling at short notice too (Phase 10 task 19, audit L20).
  if (fewerStaff) {
    const [row] = await tx
      .select({ slot: assignments.slot })
      .from(assignments)
      .where(eq(assignments.id, cancelled.assignmentId));
    const lowered = row ? await removeFreedPlace(tx, shiftId, row.slot, now) : null;
    if (lowered) {
      await recordEvent(tx, {
        actorType: by.type,
        actorId: by.id,
        action: "shift.changed",
        entityType: "shift",
        entityId: shiftId,
        data: {
          by: "firm",
          fields: ["headcount"],
          from: { headcount: lowered.from },
          to: { headcount: lowered.to },
          reason: FIRM_CHANGE_REASONS.fewer_staff,
          // The highest place's booking moved down into the freed one (its slot changed).
          ...(lowered.moved ? { moved: lowered.moved } : {}),
        },
      });
      return { ...cancelled, placesNow: lowered.to };
    }
    return cancelled;
  }
  // A place reopened close to the start: the shift is urgent (golden rule 5: logged too).
  await markUrgentAfterDropout(tx, { shiftId, now });
  return cancelled;
}

// The office cancelling a whole shift (docs/api-and-jobs.md, "Firm-initiated changes"; golden
// rule 12). In one transaction: an active admin or resourcer; the shift locked (shift first, as
// every booking); not a Google Sheet's (the sheet owns it), not one that has started, not one
// already cancelled. Each confirmed booking is cancelled through the plug (cancelled_firm, the
// reason's words on the row, notice hours from the start), logged shift.cancelled {by: "firm",
// shiftId, workerId, reason, noticeHours}, and the worker is told (a firm-change-notice job). Then
// the shift is cancelled, offers still out expire, and shift.cancelled_by_firm {reason, bookings}
// is logged. No offer waves: there's no shift to fill.

export const cancelShiftRequestSchema = z.strictObject({
  shiftId: rosterId,
  reason: z.enum(SHIFT_CHANGE_REASON_CODES),
  by: z.strictObject({ type: z.literal("office"), id: rosterId }),
});
export type CancelShiftRequest = z.input<typeof cancelShiftRequestSchema>;

export type CancelShiftResult =
  | { status: "cancelled"; bookings: number }
  | { status: "unchanged" } // already cancelled
  | { status: "started" }
  | { status: "sheet" }
  | { status: "not_found" }
  | { status: "not_allowed" };

export async function cancelShiftByFirm(
  run: WithFirm,
  firmId: string,
  raw: CancelShiftRequest,
  deps: { clock?: Clock } = {},
): Promise<CancelShiftResult> {
  const request = cancelShiftRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const reason = FIRM_CHANGE_REASONS[request.reason];
  return retryAborted(() =>
    run(firmId, async (tx) => {
      if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" as const };
      const [shift] = await tx
        .select({ source: shifts.source, status: shifts.status, startsAt: shifts.startsAt })
        .from(shifts)
        .where(eq(shifts.id, request.shiftId))
        .for("no key update");
      if (!shift) return { status: "not_found" as const };
      if (shift.source === "sheets") return { status: "sheet" as const };
      if (shift.status === "cancelled") return { status: "unchanged" as const };
      if (shift.startsAt.getTime() <= now.getTime()) return { status: "started" as const };

      const holders = await tx
        .select({ workerId: assignments.workerId })
        .from(assignments)
        .where(
          and(
            eq(assignments.shiftId, request.shiftId),
            eq(assignments.status, "confirmed"),
            isNotNull(assignments.workerId),
          ),
        )
        .orderBy(asc(assignments.slot));
      const plug = plugFor(tx, shift.source, now);
      let bookings = 0;
      for (const h of holders) {
        if (!h.workerId) continue;
        const cancelled = await plug.markCancelled(request.shiftId, h.workerId, {
          reason,
          by: "firm",
          at: now,
        });
        // Under the shift lock nothing else can change these bookings: anything else is a bug, and
        // the whole cancellation rolls back rather than leave someone booked on a cancelled shift.
        if (cancelled.status !== "cancelled") {
          throw new Error(`cancelling a booking returned ${cancelled.status}`);
        }
        bookings += 1;
        const eventId = await recordEvent(tx, {
          actorType: "office",
          actorId: request.by.id,
          action: "shift.cancelled",
          entityType: "assignment",
          entityId: cancelled.assignmentId,
          data: {
            by: "firm",
            shiftId: request.shiftId,
            workerId: h.workerId,
            reason,
            noticeHours: cancelled.noticeHours,
          },
        });
        await queueFirmChangeNotice(tx, { eventId, assignmentId: cancelled.assignmentId });
      }
      await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, request.shiftId));
      await tx
        .update(offers)
        .set({ response: "expired", respondedAt: now })
        .where(and(eq(offers.shiftId, request.shiftId), isNull(offers.response)));
      await recordEvent(tx, {
        actorType: "office",
        actorId: request.by.id,
        action: "shift.cancelled_by_firm",
        entityType: "shift",
        entityId: request.shiftId,
        data: { by: "firm", reason, bookings },
      });
      return { status: "cancelled" as const, bookings };
    }),
  );
}
