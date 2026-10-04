import { and, eq } from "drizzle-orm";
import type { Clock } from "../auth/clock";
import { canAccess, type OfficeArea } from "../auth/roles";
import { officeUsers } from "../db/schema";
import { withFirm, type FirmTx, type WithFirm } from "../db/scoped";

// Who is acting in an office server action: the firm comes from the request (the session's firm),
// the office user from the session. Each underlying function checks the user again inside the
// firm's transaction. Kept apart from quick-actions.ts so a path can use it without importing every
// office action (payroll's sorting path must not reach AI code: tests/unit/ai.boundary.test.ts).

export interface OfficeContext {
  firm: { id: string };
  officeUserId: string;
  run?: WithFirm; // tests pass a withFirm on their own pool
  clock?: Clock;
  localDatabase?: boolean; // tests pass false to act as on a live database (Gate B)
}

export const parts = (ctx: OfficeContext) => ({
  run: ctx.run ?? withFirm,
  by: { type: "office" as const, id: ctx.officeUserId },
  deps: ctx.clock ? { clock: ctx.clock } : {},
});

// Inside the firm's transaction: is this an active office user whose role may use `area`? (The
// page and the action check the session too; this is the check that holds when the work is done.)
export async function officeUserMay(
  tx: FirmTx,
  officeUserId: string,
  area: OfficeArea,
): Promise<boolean> {
  const [me] = await tx
    .select({ role: officeUsers.role })
    .from(officeUsers)
    .where(and(eq(officeUsers.id, officeUserId), eq(officeUsers.status, "active")));
  return me !== undefined && canAccess(me.role, area);
}
