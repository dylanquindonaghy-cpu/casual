import { and, eq } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { assignments, shifts } from "../db/schema";
import { withFirm } from "../db/scoped";
import { noticeHours } from "../roster/notice";
import { decideForWorker, firmStrikeSettings, liveStrikeCount } from "../strikes/issue";
import { STRIKE_WARNING_VERSION, strikeWarningText, warningKind } from "../strikes/words";
import type { CancelWarningOutcome } from "./cancel-reasons";
import type { PortalContext } from "./my-shifts";

// The strike warning on the casual's cancel step (docs/office-v2.md 4.5, 5.7 item 4), worked out
// when they open the step, by the same strikeDecision() that runs when they confirm (with no reason
// yet: the reason only flags a strike for review). Read only. Server only.

export async function cancelWarning(
  ctx: PortalContext & { firm: { id: string } },
  workerId: string,
  shiftId: string,
): Promise<CancelWarningOutcome> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [shift] = await tx
      .select({ startsAt: shifts.startsAt })
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    if (!shift) return { status: "not_booked" as const };
    if (shift.startsAt.getTime() <= now.getTime()) return { status: "started" as const };
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
    if (!booking) return { status: "not_booked" as const };
    const settings = await firmStrikeSettings(tx);
    const notice = noticeHours(shift.startsAt, now);
    const decision = await decideForWorker(tx, {
      assignmentId: booking.id,
      shiftId,
      noticeHours: notice,
      reason: null,
      settings,
    });
    const kind = warningKind(decision);
    return {
      status: "ok" as const,
      warning: {
        kind,
        version: STRIKE_WARNING_VERSION,
        text: strikeWarningText(kind, {
          hoursToStart: notice,
          thresholdHours: settings.noticeHours,
          firmName: settings.firmName,
          liveStrikes: await liveStrikeCount(tx, workerId, now),
          liveDays: settings.liveDays,
        }),
      },
    };
  });
}
