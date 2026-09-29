import type { Clock } from "../auth/clock";
import { withFirm, type WithFirm } from "../db/scoped";
import { queueOfficeOffer, type QueueOfficeOfferResult } from "../offers/office-offer";
import { bookShift, type BookingResult } from "../roster/book";
import { closeShift, reopenShift, type CloseShiftResult } from "../roster/close";
import type { OverridableCode } from "../rules/eligibility";
import { setShiftUrgent, type SetUrgentResult } from "../roster/urgent";

// Today's quick actions for server actions: the firm comes from the request (the session's firm),
// the office user from the session. Each underlying function checks the user again inside the
// firm's transaction (an active admin or resourcer).

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
