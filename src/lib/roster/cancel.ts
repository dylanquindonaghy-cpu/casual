import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { assignments, offers, shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace, plugFor, rosterId } from "./book";
import {
  callerActor,
  callerMarks,
  firmCallerMay,
  firmCallerSchema,
  sourceRefusal,
} from "./firm-caller";
import { plannerIsConnector } from "./planner-kind";
import type { CancelResult } from "./plug";
import { queueFirmChangeNotice } from "../notices/firm-change";
import { placeAfterCancel, removeFreedPlace } from "./native";
import { markUrgentAfterDropout } from "./urgent";
import { FIRM_CHANGE_REASONS, SHIFT_CHANGE_REASON_CODES, firmReasonWords } from "./firm-reasons";
import { noticeHours } from "./notice";
import { strikeDecision, type StrikeDecision } from "../strikes/decide";
import { decideForWorker, firmStrikeSettings, issueStrike } from "../strikes/issue";
import { STRIKE_WARNING_VERSION, warningKind, type WarningKind } from "../strikes/words";

// Cancelling a booking: the one path for a worker cancelling their own shift, or the office
// cancelling someone's (golden rules 5 and 12; docs/architecture.md, "Cancel"). In its own
// transaction (a deadlock retries it, twice at most):
//   1. who may cancel whom: a worker only their own booking, and not once the shift has started
//      (that's a conversation with the office); the office only as an active admin or resourcer,
//      and not once the shift has ended (then it's who worked it: attendance.ts);
//   2. the plug's markCancelled: locks the shift, frees the place (reopened only while the shift
//      hasn't started), and stores on the assignment row who cancelled, why, when and the notice
//      hours (shift start minus now);
//   3. the shift.cancelled event, in the same transaction, with the strike decision's code
//      (src/lib/strikes/decide.ts, 12C.1): the office's cancellation is never a strike; a worker's
//      own is decided from the notice, who booked it and whether the office changed it since, and
//      a strike row (strike.issued) is added only when one is issued. A worker who saw a warning
//      sends which kind it was and its version: if the decision now differs (the notice crossed
//      the threshold while they read it, say) or the version isn't the current one, nothing is
//      cancelled and they're shown the new one ("warning_changed"); otherwise the warning's
//      version and the time are kept on the booking. A strike is only ever issued against a
//      warning that said so: a worker's cancellation that would be a strike, sent with no warning
//      (a path that shows none), is refused the same way.
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
    z.strictObject({
      type: z.literal("worker"),
      id: rosterId,
      // The strike warning on their screen when they confirmed (the cancel step in the app).
      warning: z
        .strictObject({
          kind: z.enum(["strike", "exempt", "notice"]),
          version: z.string().min(1).max(40),
        })
        .optional(),
    }),
    z.strictObject({ type: z.literal("office"), id: rosterId }),
  ]),
});
export type CancelRequest = z.input<typeof cancelRequestSchema>;

export type CancelBookingResult =
  | Exclude<CancelResult, { status: "cancelled" }>
  // A worker asking after the shift started: the office handles it.
  | { status: "started" }
  // The office asking after the shift ended: that's a no-show or a completed shift (attendance.ts).
  | { status: "ended" }
  // The office user can't cancel staff (disabled, or payroll).
  | { status: "not_allowed" }
  // "The client needs fewer staff" takes the place away, which can't be done for a shift's last
  // place (that's cancelling the shift), a rota sheet's shift (the sheet sets its places) or a
  // session from the firm's planner (the planner sets its places). Refused, so the place isn't
  // left open for someone else to take; nothing is changed.
  | { status: "keeps_place"; why: "last_place" | "sheet" | "planner" }
  // The worker's warning no longer matches what would happen: nothing changed; show them this one.
  | { status: "warning_changed"; kind: WarningKind }
  // A "fewer staff" cancellation: the shift needs this many now. `strike`: the strike just issued.
  | (CancelResult & {
      status: "cancelled";
      placesNow?: number;
      strike?: { strikeId: string; expiresAt: Date } | null;
    });

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
  // A connector's session: cancelled in the firm's own system, which comes back in
  // (planner-kind.ts).
  if (shift.source === "api" && (await plannerIsConnector(tx))) return { status: "needs_approval" };
  if (by.type === "worker" && shift.startsAt.getTime() <= now.getTime()) {
    return { status: "started" };
  }
  if (shift.endsAt.getTime() <= now.getTime()) return { status: "ended" };
  const fewerStaff = by.type === "office" && reason === FIRM_CHANGE_REASONS.fewer_staff;
  if (fewerStaff && shift.source === "sheets") return { status: "keeps_place", why: "sheet" };
  if (fewerStaff && shift.source === "api") return { status: "keeps_place", why: "planner" };
  if (fewerStaff && shift.headcount <= 1) return { status: "keeps_place", why: "last_place" };

  const initiator = by.type === "worker" ? "worker" : "firm";
  // The strike decision, before anything changes (the shift is locked: its start can't move).
  const notice = noticeHours(shift.startsAt, now);
  const strikes = by.type === "worker" ? await firmStrikeSettings(tx) : null;
  // The office's: never a strike. A worker's: decided below, on their confirmed booking (without
  // one, the plug changes nothing).
  let decision: StrikeDecision = strikeDecision({ cancelledBy: "firm" });
  let decidedOn: string | null = null; // the booking a worker's decision was made on
  if (by.type === "worker" && strikes) {
    const [booking] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
        ),
      );
    if (booking) {
      decision = await decideForWorker(tx, {
        assignmentId: booking.id,
        shiftId,
        noticeHours: notice,
        reason,
        settings: strikes,
      });
      const kind = warningKind(decision);
      const seen = by.warning;
      const stale = seen
        ? seen.kind !== kind || seen.version !== STRIKE_WARNING_VERSION
        : kind === "strike";
      if (stale) return { status: "warning_changed", kind };
      decidedOn = booking.id;
    }
  }

  const cancelled = await plugFor(tx, shift.source, now).markCancelled(shiftId, workerId, {
    reason,
    by: initiator,
    at: now,
    via: by.type === "worker" ? "app" : "office",
  });
  if (cancelled.status !== "cancelled") return cancelled;
  if (cancelled.noticeHours !== notice) {
    throw new Error("the booking's notice differs from the one the strike was decided on");
  }
  if (decidedOn !== null && cancelled.assignmentId !== decidedOn) {
    throw new Error("the booking cancelled differs from the one the strike was decided on");
  }
  if (by.type === "worker" && by.warning) {
    await tx
      .update(assignments)
      .set({ strikeWarningVersion: STRIKE_WARNING_VERSION, strikeWarningShownAt: now })
      .where(eq(assignments.id, cancelled.assignmentId));
  }
  const strike =
    decision.result === "strike" && strikes
      ? await issueStrike(tx, {
          decision,
          workerId,
          assignmentId: cancelled.assignmentId,
          shiftId,
          noticeHours: notice,
          settings: strikes,
          now,
        })
      : null;

  // What became of the place (recorded in the entry: 12C.3). The client needs fewer staff: the
  // place goes rather than being offered to someone else, who might then need cancelling at short
  // notice too (Phase 10 task 19, audit L20).
  let place = await placeAfterCancel(tx, cancelled.assignmentId);
  let lowered: Awaited<ReturnType<typeof removeFreedPlace>> = null;
  if (fewerStaff) {
    const [row] = await tx
      .select({ slot: assignments.slot })
      .from(assignments)
      .where(eq(assignments.id, cancelled.assignmentId));
    lowered = row ? await removeFreedPlace(tx, shiftId, row.slot, now) : null;
    if (lowered) place = { place: "removed" };
  }

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
      strike: decision.code,
      ...place,
    },
  });
  // The firm cancelled someone's booking: they're told (golden rule 12).
  if (initiator === "firm") {
    await queueFirmChangeNotice(tx, { eventId, assignmentId: cancelled.assignmentId });
  }
  if (fewerStaff) {
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
      return { ...cancelled, placesNow: lowered.to, strike };
    }
    return { ...cancelled, strike };
  }
  // A place reopened close to the start: the shift is urgent (golden rule 5: logged too).
  await markUrgentAfterDropout(tx, { shiftId, now });
  return { ...cancelled, strike };
}

// The firm cancelling a whole shift (docs/api-and-jobs.md, "Firm-initiated changes"; golden
// rule 12): the office, or the firm's planner through the API (src/lib/roster/firm-caller.ts). In
// one transaction: the caller checked (an active admin or resourcer, or a live key); the shift
// locked (shift first, as every booking); not a Google Sheet's (the sheet owns it), nor a
// planner's for the office (the planner only its own), not one that has started, not one already
// cancelled. Each confirmed booking is cancelled through the plug (cancelled_firm, the reason's
// words on the row, notice hours from the start, cancel_via "office" or "api"), logged
// shift.cancelled {by: "firm", shiftId, workerId, reason, noticeHours} (never a strike), and the
// worker is told (a firm-change-notice job). Then the shift is cancelled, offers still out expire,
// and shift.cancelled_by_firm {reason, bookings} is logged. The planner's entries also carry
// {via: "api", keyId} (a connector's, {via: "api", sourceId}), with the system actor. No offer
// waves: there's no shift to fill.

export const cancelShiftRequestSchema = z.strictObject({
  shiftId: rosterId,
  reason: z.enum(SHIFT_CHANGE_REASON_CODES),
  by: firmCallerSchema,
});
export type CancelShiftRequest = z.input<typeof cancelShiftRequestSchema>;

export type CancelShiftResult =
  | { status: "cancelled"; bookings: number }
  | { status: "unchanged" } // already cancelled
  | { status: "started" }
  | { status: "sheet" } // the office, on a Google Sheet's shift
  | { status: "planner" } // the office, on a session from the firm's planner
  | { status: "not_found" } // also the planner, on a session it didn't send
  | { status: "not_allowed" }; // not an active admin or resourcer, or a key no longer live

export async function cancelShiftByFirm(
  run: WithFirm,
  firmId: string,
  raw: CancelShiftRequest,
  deps: { clock?: Clock } = {},
): Promise<CancelShiftResult> {
  const request = cancelShiftRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() => run(firmId, (tx) => cancelShiftInTransaction(tx, request, now)));
}

const cancelShiftInTxSchema = cancelShiftRequestSchema.extend({ now: z.date() });

// The cancellation inside a transaction the caller already holds (the planner's PUT: one
// transaction for the whole session). Take the key's lock (firmCallerMay) before locking the
// session, as this does, so every path locks the key first.
export function cancelShiftInTx(
  tx: FirmTx,
  input: z.input<typeof cancelShiftInTxSchema>,
): Promise<CancelShiftResult> {
  const { now, ...request } = cancelShiftInTxSchema.parse(input);
  return cancelShiftInTransaction(tx, request, now);
}

async function cancelShiftInTransaction(
  tx: FirmTx,
  request: z.output<typeof cancelShiftRequestSchema>,
  now: Date,
): Promise<CancelShiftResult> {
  const { shiftId, by } = request;
  const reason = FIRM_CHANGE_REASONS[request.reason];
  if (!(await firmCallerMay(tx, by))) return { status: "not_allowed" };
  const [shift] = await tx
    .select({ source: shifts.source, status: shifts.status, startsAt: shifts.startsAt })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  if (!shift) return { status: "not_found" };
  const refused = sourceRefusal(shift.source, by);
  if (refused) return refused;
  if (shift.status === "cancelled") return { status: "unchanged" };
  if (shift.startsAt.getTime() <= now.getTime()) return { status: "started" };

  const holders = await tx
    .select({ workerId: assignments.workerId })
    .from(assignments)
    .where(
      and(
        eq(assignments.shiftId, shiftId),
        eq(assignments.status, "confirmed"),
        isNotNull(assignments.workerId),
      ),
    )
    .orderBy(asc(assignments.slot));
  const plug = plugFor(tx, shift.source, now);
  const actor = callerActor(by);
  const marks = callerMarks(by);
  let bookings = 0;
  for (const h of holders) {
    if (!h.workerId) continue;
    const cancelled = await plug.markCancelled(shiftId, h.workerId, {
      reason,
      by: "firm",
      at: now,
      via: by.type === "office" ? "office" : "api",
    });
    // Under the shift lock nothing else can change these bookings: anything else is a bug, and
    // the whole cancellation rolls back rather than leave someone booked on a cancelled shift.
    if (cancelled.status !== "cancelled") {
      throw new Error(`cancelling a booking returned ${cancelled.status}`);
    }
    bookings += 1;
    const eventId = await recordEvent(tx, {
      ...actor,
      action: "shift.cancelled",
      entityType: "assignment",
      entityId: cancelled.assignmentId,
      data: {
        by: "firm",
        ...marks,
        shiftId,
        workerId: h.workerId,
        reason,
        noticeHours: cancelled.noticeHours,
        strike: strikeDecision({ cancelledBy: "firm" }).code,
        place: "session_cancelled",
      },
    });
    await queueFirmChangeNotice(tx, { eventId, assignmentId: cancelled.assignmentId });
  }
  await tx.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, shiftId));
  await tx
    .update(offers)
    .set({ response: "expired", respondedAt: now })
    .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)));
  await recordEvent(tx, {
    ...actor,
    action: "shift.cancelled_by_firm",
    entityType: "shift",
    entityId: shiftId,
    data: { by: "firm", ...marks, reason, bookings },
  });
  return { status: "cancelled", bookings };
}
