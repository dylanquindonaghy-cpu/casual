import { and, eq } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { bookShift } from "../roster/book";
import { roleLabel, shiftWhen, soonLabel } from "./format";
import type { PortalContext } from "./my-shifts";

// "Take shift" for the logged-in worker (docs/architecture.md, "Take an open shift"): bookShift()
// does the booking (rules on the current rows, live-source check, first yes wins, the event). This
// turns its result into what the worker's screen needs: a confirmation they can screenshot (what,
// when, a reference, the firm's sign-off), or a plain answer. Plain data only (it crosses from the
// server action to the browser).

export type TakeShiftOutcome =
  | {
      status: "booked";
      ref: string; // the first 8 characters of the booking id, upper case
      // Null only if the details couldn't be read after the booking was saved: the worker is
      // still told they're booked, with the reference.
      when: string | null; // "Sat 7 Nov, 14:00 to 22:00"
      role: string | null; // "Door supervisor"
      siteName: string | null;
      signOff: string;
    }
  | { status: "filled" } // someone else said yes first
  | { status: "already_assigned" }
  | { status: "gone" } // not open any more, or not there
  | { status: "not_eligible"; reasons: string[] }
  | { status: "try_again" } // the firm's sheet copy is too old to confirm against
  | { status: "not_yet"; opensAt: string } // fair rotation: held for others until this time
  | { status: "logged_out" }
  | { status: "error" };

export async function takeShift(
  ctx: PortalContext & { firm: { id: string; timezone: string; signOff: string } },
  workerId: string,
  shiftId: string,
): Promise<TakeShiftOutcome> {
  const run = ctx.run ?? withFirm;
  const clock = ctx.clock ?? systemClock;
  const result = await bookShift(
    run,
    ctx.firm.id,
    { shiftId, workerId, by: { type: "worker", id: workerId } },
    { clock },
  );
  switch (result.status) {
    case "booked": {
      const booked = {
        status: "booked" as const,
        ref: result.assignmentId.slice(0, 8).toUpperCase(),
        signOff: ctx.firm.signOff,
      };
      // The booking is saved: whatever happens reading its details, the answer is "booked".
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
      if (!shift) return { ...booked, when: null, role: null, siteName: null };
      return {
        ...booked,
        when: shiftWhen(shift.startsAt, shift.endsAt, ctx.firm.timezone),
        role: roleLabel(shift.role),
        siteName: shift.siteName,
      };
    }
    case "filled":
    case "already_assigned":
      return { status: result.status };
    case "not_eligible":
      return { status: "not_eligible", reasons: result.reasons };
    case "source_stale":
      return { status: "try_again" };
    case "not_yet":
      return {
        status: "not_yet",
        opensAt: soonLabel(result.opensAt, clock.now(), ctx.firm.timezone),
      };
    case "not_open":
    case "not_found":
      return { status: "gone" };
    default:
      // not_allowed, invalid_reason and needs_approval can't happen for a worker booking
      // themselves on our tables.
      return { status: "error" };
  }
}
