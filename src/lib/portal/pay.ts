import { and, desc, eq, gte } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import type { ActiveSession } from "../auth/sessions";
import { isSteppedUp } from "../auth/step-up";
import { payRecords } from "../db/schema";
import { withFirm } from "../db/scoped";
import { addDays, localDateOf } from "../time/zoned";
import type { PortalContext } from "./my-shifts";
import type { PayLine } from "./pay-format";

export type { PayLine } from "./pay-format";

// The pay page's figures (docs/screens.md, `/pay`): the worker's imported pay records whose period
// ended in the last 8 weeks, newest first. Only for a session that passed the pay-page code in the
// last 30 minutes: this checks that itself, whatever the page did (the rule on steppedUpWorker()).
// The figures are the payroll's as imported; nothing is worked out here (golden rules 1 and 9).

export const PAY_WEEKS = 8;

// No code, an expired one, or another worker's session: no figures. The page shows the code gate
// instead (the window can run out between the page's check and this one).
export class StepUpRequiredError extends Error {
  constructor() {
    super("pay data needs this worker's correct code from the last 30 minutes");
    this.name = "StepUpRequiredError";
  }
}

export async function myPay(
  ctx: PortalContext & { firm: { id: string; timezone: string } },
  stepped: { worker: { id: string }; session: ActiveSession },
): Promise<PayLine[]> {
  const now = (ctx.clock ?? systemClock).now();
  const { session, worker } = stepped;
  if (session.kind !== "worker" || session.subjectId !== worker.id || !isSteppedUp(session, now)) {
    throw new StepUpRequiredError();
  }
  const since = addDays(localDateOf(now, ctx.firm.timezone), -PAY_WEEKS * 7);
  const run = ctx.run ?? withFirm;
  const rows = await run(ctx.firm.id, (tx) =>
    tx
      .select({
        periodStart: payRecords.periodStart,
        periodEnd: payRecords.periodEnd,
        hours: payRecords.hours,
        ratePence: payRecords.ratePence,
        grossPence: payRecords.grossPence,
        payDate: payRecords.payDate,
      })
      .from(payRecords)
      .where(and(eq(payRecords.workerId, worker.id), gte(payRecords.periodEnd, since)))
      .orderBy(
        desc(payRecords.periodEnd),
        desc(payRecords.periodStart),
        desc(payRecords.ratePence),
      ),
  );
  return rows.map((r) => ({ ...r, hours: Number(r.hours) }));
}
