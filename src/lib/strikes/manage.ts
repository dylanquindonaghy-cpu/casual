import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { strikes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { WITHDRAW_REASON_MAX } from "../office/strike-actions-copy";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";

// Withdrawing a strike and keeping one flagged for review (docs/office-v2.md 3.5; 12C.5), from the
// strike's cancellation record. Admins and resourcers (the `strikes` area), checked again inside
// the firm's transaction. Each is one conditional UPDATE, so two at once can't both happen.
//
// - Withdraw: a live strike only; the reason (1–500 characters, after trimming) stays on the strike
//   row with who and when, never in the log; the review flag goes with it (a withdrawn strike needs
//   no review). Logged strike.withdrawn with ids only. It stops counting at once (the live count
//   reads `status`). The firm's planner hears of it by webhook (12J.2).
// - Keep: a live strike flagged for review; clears the flag, who and when on the row; logged
//   strike.reviewed {outcome: "kept"}.

const reasonSchema = z.string().trim().min(1).max(WITHDRAW_REASON_MAX);

export type WithdrawStrikeResult =
  | { status: "withdrawn" }
  | { status: "invalid" } // no reason, or too long
  | { status: "not_live" } // already withdrawn
  | { status: "not_found" } // no strike on this booking
  | { status: "not_allowed" };

export type KeepStrikeResult =
  | { status: "kept" }
  | { status: "not_flagged" } // not waiting for a review (kept already, or withdrawn)
  | { status: "not_found" }
  | { status: "not_allowed" };

async function strikeOn(tx: FirmTx, assignmentId: string) {
  const [row] = await tx
    .select({ id: strikes.id })
    .from(strikes)
    .where(eq(strikes.assignmentId, assignmentId));
  return row ?? null;
}

export async function withdrawStrike(
  ctx: OfficeContext,
  assignmentId: string,
  rawReason: unknown,
): Promise<WithdrawStrikeResult> {
  const reason = reasonSchema.safeParse(rawReason);
  if (!reason.success) return { status: "invalid" };
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "strikes"))) {
      return { status: "not_allowed" as const };
    }
    const [done] = await tx
      .update(strikes)
      .set({
        status: "withdrawn",
        withdrawnBy: ctx.officeUserId,
        withdrawnAt: now,
        withdrawnReason: reason.data,
        reviewNeeded: false,
      })
      .where(and(eq(strikes.assignmentId, assignmentId), eq(strikes.status, "live")))
      .returning({ id: strikes.id, workerId: strikes.workerId, shiftId: strikes.shiftId });
    if (!done) {
      return (await strikeOn(tx, assignmentId))
        ? { status: "not_live" as const }
        : { status: "not_found" as const };
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "strike.withdrawn",
      entityType: "strike",
      entityId: done.id,
      data: { assignmentId, shiftId: done.shiftId, workerId: done.workerId },
    });
    return { status: "withdrawn" as const };
  });
}

export async function keepStrike(
  ctx: OfficeContext,
  assignmentId: string,
): Promise<KeepStrikeResult> {
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "strikes"))) {
      return { status: "not_allowed" as const };
    }
    const [done] = await tx
      .update(strikes)
      .set({ reviewNeeded: false, reviewedBy: ctx.officeUserId, reviewedAt: now })
      .where(
        and(
          eq(strikes.assignmentId, assignmentId),
          eq(strikes.status, "live"),
          sql`${strikes.reviewNeeded}`,
        ),
      )
      .returning({ id: strikes.id, workerId: strikes.workerId, shiftId: strikes.shiftId });
    if (!done) {
      return (await strikeOn(tx, assignmentId))
        ? { status: "not_flagged" as const }
        : { status: "not_found" as const };
    }
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "strike.reviewed",
      entityType: "strike",
      entityId: done.id,
      data: { assignmentId, shiftId: done.shiftId, workerId: done.workerId, outcome: "kept" },
    });
    return { status: "kept" as const };
  });
}
