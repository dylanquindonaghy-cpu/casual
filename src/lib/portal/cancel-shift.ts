import { and, eq } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { cancelBooking } from "../roster/cancel";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { roleLabel, shiftWhen } from "./format";
import type { CancelShiftOutcome } from "./cancel-reasons";
import { cancelWarning } from "./cancel-warning";
import type { PortalContext } from "./my-shifts";

export {
  CANCEL_REASONS,
  cancelReason,
  MAX_NOTE_LENGTH,
  noticeText,
  OTHER_REASON,
  type CancelShiftOutcome,
} from "./cancel-reasons";

// "Cancel this shift" for the logged-in worker (docs/architecture.md, "Cancel"): cancelBooking()
// records it (reason and notice hours on the booking, the event in the log, and a strike when one
// is issued: 12C.1). This turns its result into what the worker's screen needs: an instant
// confirmation with the shift, when it was recorded, the notice they gave, the booking's reference,
// whether a strike was recorded and until when, signed by the firm; or a plain answer. `warning`
// is the strike warning they confirmed against (its kind and version); if what would happen has
// changed since, nothing is cancelled and they get the new warning. Plain data only. Server only
// (it reaches the database): the browser-safe reasons and wording live in cancel-reasons.ts.

export async function cancelMyShift(
  ctx: PortalContext & { firm: { id: string; timezone: string; signOff: string } },
  workerId: string,
  shiftId: string,
  reason: string,
  warning: { kind: "strike" | "exempt" | "notice"; version: string },
): Promise<CancelShiftOutcome> {
  const run = ctx.run ?? withFirm;
  const now = (ctx.clock ?? systemClock).now();
  const result = await cancelBooking(
    run,
    ctx.firm.id,
    { shiftId, workerId, reason, by: { type: "worker", id: workerId, warning } },
    { clock: { now: () => now } },
  );
  switch (result.status) {
    case "warning_changed": {
      const fresh = await cancelWarning({ ...ctx, clock: { now: () => now } }, workerId, shiftId);
      return fresh.status === "ok" ? { status: "warning_changed", warning: fresh.warning } : fresh;
    }
    case "cancelled": {
      const w = wallTimeOf(now, ctx.firm.timezone);
      const pad = (n: number) => String(n).padStart(2, "0");
      const cancelled = {
        status: "cancelled" as const,
        ref: result.assignmentId.slice(0, 8).toUpperCase(),
        noticeHours: result.noticeHours,
        recordedAt: `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(localDateOf(now, ctx.firm.timezone))}`,
        signOff: ctx.firm.signOff,
        strike: result.strike
          ? { until: dayLabel(localDateOf(result.strike.expiresAt, ctx.firm.timezone)) }
          : null,
      };
      // It's recorded: whatever happens reading the details, the answer is "cancelled".
      const shift = await run(ctx.firm.id, (tx) =>
        tx
          .select({
            role: shifts.role,
            startsAt: shifts.startsAt,
            endsAt: shifts.endsAt,
            siteName: sites.name,
          })
          .from(shifts)
          .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
          .where(eq(shifts.id, shiftId)),
      ).then(
        ([row]) => row,
        () => undefined,
      );
      if (!shift) return { ...cancelled, when: null, role: null, siteName: null };
      return {
        ...cancelled,
        when: shiftWhen(shift.startsAt, shift.endsAt, ctx.firm.timezone),
        role: roleLabel(shift.role),
        siteName: shift.siteName,
      };
    }
    case "started":
      return { status: "started" };
    case "not_assigned":
    case "not_found":
      return { status: "not_booked" };
    default:
      // ended, not_allowed and needs_approval can't happen for a worker on a shift that hasn't
      // started, on our tables.
      return { status: "error" };
  }
}
