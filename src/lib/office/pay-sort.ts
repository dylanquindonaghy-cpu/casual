import { resolvePayQueries, type ResolvePayQueriesResult } from "../pay/resolve";
import { parts, type OfficeContext } from "./office-context";

// Payroll sorting the pay queries it saw in a group, with a note each worker gets (payroll or an
// admin: checked inside). Its own module, not in quick-actions.ts: the path where payroll's note is
// written imports nothing that reaches AI code (tests/unit/ai.boundary.test.ts).
export function sortPayQueries(
  ctx: OfficeContext,
  ids: string[],
  note: string,
): Promise<ResolvePayQueriesResult> {
  const { run, by, deps } = parts(ctx);
  return resolvePayQueries(run, ctx.firm.id, { ids, note, by }, deps);
}
