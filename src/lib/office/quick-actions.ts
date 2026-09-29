import type { Clock } from "../auth/clock";
import { withFirm, type WithFirm } from "../db/scoped";
import {
  saveFigures,
  updateFiguresNow,
  type FigureKind,
  type SaveFiguresResult,
  type UpdateNowResult,
} from "../metrics/entry";
import { queueOfficeOffer, type QueueOfficeOfferResult } from "../offers/office-offer";
import { queuePayDigestNow, type SendDigestNowResult } from "../pay/digest";
import {
  markAttendance,
  markRestWorked,
  type AttendanceOutcome,
  type MarkAttendanceResult,
  type MarkRestWorkedResult,
} from "../roster/attendance";
import { bookShift, type BookingResult } from "../roster/book";
import {
  cancelBooking,
  cancelShiftByFirm,
  type CancelBookingResult,
  type CancelShiftResult,
} from "../roster/cancel";
import { closeShift, reopenShift, type CloseShiftResult } from "../roster/close";
import { moveShiftByFirm, type MoveShiftResult } from "../roster/firm-change";
import { FIRM_CHANGE_REASONS, type FirmChangeReason } from "../roster/firm-reasons";
import type { OverridableCode } from "../rules/eligibility";
import { setShiftUrgent, type SetUrgentResult } from "../roster/urgent";
import {
  resolveRequest,
  type RequestDecision,
  type ResolveRequestResult,
} from "../requests/resolve";

// Today's quick actions for server actions: the firm comes from the request (the session's firm),
// the office user from the session. Each underlying function checks the user again inside the
// firm's transaction (an active admin or resourcer; for the payroll digest, payroll or an admin).

export interface OfficeContext {
  firm: { id: string };
  officeUserId: string;
  run?: WithFirm; // tests pass a withFirm on their own pool
  clock?: Clock;
}

const parts = (ctx: OfficeContext) => ({
  run: ctx.run ?? withFirm,
  by: { type: "office" as const, id: ctx.officeUserId },
  deps: ctx.clock ? { clock: ctx.clock } : {},
});

export function markUrgent(
  ctx: OfficeContext,
  shiftId: string,
  urgent: boolean,
): Promise<SetUrgentResult> {
  const { run, by, deps } = parts(ctx);
  return setShiftUrgent(run, ctx.firm.id, { shiftId, urgent, by }, deps);
}

export function markFilled(ctx: OfficeContext, shiftId: string): Promise<CloseShiftResult> {
  const { run, by, deps } = parts(ctx);
  return closeShift(run, ctx.firm.id, { shiftId, by }, deps);
}

export function openAgain(ctx: OfficeContext, shiftId: string): Promise<CloseShiftResult> {
  const { run, by, deps } = parts(ctx);
  return reopenShift(run, ctx.firm.id, { shiftId, by }, deps);
}

export function offerTo(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
): Promise<QueueOfficeOfferResult> {
  const { run, by, deps } = parts(ctx);
  return queueOfficeOffer(run, ctx.firm.id, { shiftId, workerId, by }, deps);
}

// The office placing someone on a shift ("Assign" on the shift's page): the one booking path,
// with the office's overrides (only started, rest, weekly hours or a day off) and a reason when it
// overrides anything. Logged shift.assigned {by: "firm", overridden, reason}.
export function assignWorker(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
  override: { codes: OverridableCode[]; reason: string } | null,
): Promise<BookingResult> {
  const { run, deps } = parts(ctx);
  return bookShift(
    run,
    ctx.firm.id,
    {
      shiftId,
      workerId,
      by: {
        type: "office",
        id: ctx.officeUserId,
        overrides: override?.codes ?? [],
        ...(override ? { reason: override.reason } : {}),
      },
    },
    deps,
  );
}

// The office's firm-initiated changes (golden rule 12): each takes a reason from the fixed list,
// logs notice hours per booked worker and tells them (src/lib/roster/cancel.ts, firm-change.ts).
export function moveShift(
  ctx: OfficeContext,
  shiftId: string,
  input: { date: string; start: string; end: string; siteId: string; reason: FirmChangeReason },
): Promise<MoveShiftResult> {
  const { run, by, deps } = parts(ctx);
  return moveShiftByFirm(run, ctx.firm.id, { shiftId, ...input, by }, deps);
}

export function cancelShift(
  ctx: OfficeContext,
  shiftId: string,
  reason: FirmChangeReason,
): Promise<CancelShiftResult> {
  const { run, by, deps } = parts(ctx);
  return cancelShiftByFirm(run, ctx.firm.id, { shiftId, reason, by }, deps);
}

export function cancelBookingByOffice(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
  reason: FirmChangeReason,
): Promise<CancelBookingResult> {
  const { run, by, deps } = parts(ctx);
  return cancelBooking(
    run,
    ctx.firm.id,
    { shiftId, workerId, reason: FIRM_CHANGE_REASONS[reason], by },
    deps,
  );
}

export function markAttended(
  ctx: OfficeContext,
  shiftId: string,
  workerId: string,
  outcome: AttendanceOutcome,
): Promise<MarkAttendanceResult> {
  const { run, by, deps } = parts(ctx);
  return markAttendance(run, ctx.firm.id, { shiftId, workerId, outcome, by }, deps);
}

export function markTheRestWorked(
  ctx: OfficeContext,
  shiftId: string,
): Promise<MarkRestWorkedResult> {
  const { run, by, deps } = parts(ctx);
  return markRestWorked(run, ctx.firm.id, { shiftId, by }, deps);
}

export function answerRequest(
  ctx: OfficeContext,
  requestId: string,
  decision: RequestDecision,
  note: string,
): Promise<ResolveRequestResult> {
  const { run, by, deps } = parts(ctx);
  return resolveRequest(run, ctx.firm.id, { requestId, decision, note, by }, deps);
}

export function savePilotFigures(
  ctx: OfficeContext,
  kind: FigureKind,
  weekStart: string,
  values: Record<string, string>,
): Promise<SaveFiguresResult> {
  const { run, by, deps } = parts(ctx);
  return saveFigures(run, ctx.firm.id, { kind, weekStart, values, by }, deps);
}

export function updatePilotFiguresNow(ctx: OfficeContext): Promise<UpdateNowResult> {
  const { run, by, deps } = parts(ctx);
  return updateFiguresNow(run, ctx.firm.id, by, deps);
}

// Payroll's "Send the digest now" (an active payroll user or admin: checked inside).
export function sendPayDigestNow(ctx: OfficeContext): Promise<SendDigestNowResult> {
  const { run, by, deps } = parts(ctx);
  return queuePayDigestNow(run, ctx.firm.id, by, deps);
}
