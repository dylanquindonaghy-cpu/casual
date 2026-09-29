import type { Clock } from "../auth/clock";
import { withFirm, type WithFirm } from "../db/scoped";

// Who is acting in an office server action: the firm comes from the request (the session's firm),
// the office user from the session. Each underlying function checks the user again inside the
// firm's transaction. Kept apart from quick-actions.ts so a path can use it without importing every
// office action (payroll's sorting path must not reach AI code: tests/unit/ai.boundary.test.ts).

export interface OfficeContext {
  firm: { id: string };
  officeUserId: string;
  run?: WithFirm; // tests pass a withFirm on their own pool
  clock?: Clock;
}

export const parts = (ctx: OfficeContext) => ({
  run: ctx.run ?? withFirm,
  by: { type: "office" as const, id: ctx.officeUserId },
  deps: ctx.clock ? { clock: ctx.clock } : {},
});
