import { systemClock } from "../auth/clock";
import { LIMITS, throttle } from "../auth/throttle";
import { withFirm } from "../db/scoped";
import { appEnv } from "../env";
import { askForShift } from "../roster/asks";
import { timeOnDay } from "./format";
import type { PortalContext } from "./my-shifts";

// "I can do this" for the logged-in casual (Phase 26.6, ses-6): askForShift() saves the ask (the
// session shown, open, not started, a place free, the rules on the current rows); this turns its
// answer into what her screen needs. Every tap counts towards the same limit as "Take shift"
// (LIMITS.takePerWorker), in its own short transaction first. Plain data only (it crosses from the
// server action to the browser).

export type AskShiftOutcome =
  | { status: "asked"; at: string } // "14:02 on Fri 6 Nov"
  | { status: "not_this_time" }
  | { status: "take_it" } // the office no longer chooses for it, or she holds an offer: take it
  | { status: "booked" } // she's booked on it already
  | { status: "filled" }
  | { status: "gone" }
  | { status: "not_eligible"; reasons: string[] }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "logged_out" }
  | { status: "error" };

export async function askShift(
  ctx: PortalContext & { firm: { id: string; timezone: string }; secret?: string },
  workerId: string,
  shiftId: string,
): Promise<AskShiftOutcome> {
  const run = ctx.run ?? withFirm;
  const clock = ctx.clock ?? systemClock;
  const limited = await throttle(
    run,
    ctx.firm.id,
    [{ limit: LIMITS.takePerWorker, value: workerId }],
    {
      now: clock.now(),
      secret: ctx.secret ?? appEnv().SESSION_SECRET,
      entityType: "worker",
      entityId: workerId,
    },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  const result = await askForShift(run, ctx.firm.id, { shiftId, workerId }, { clock });
  switch (result.status) {
    case "asked":
    case "already_asked":
      return { status: "asked", at: timeOnDay(result.askedAt, ctx.firm.timezone) };
    case "not_eligible":
      return { status: "not_eligible", reasons: result.reasons };
    default:
      return { status: result.status };
  }
}
