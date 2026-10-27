import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import type { FirmTx } from "../db/scoped";
import { part, type Part } from "./dashboard";
import { offerStateSql } from "./dashboard-charts-load";
import { bookedJoin, placeFree, urgentGap } from "./events";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// The top bar's counts of sessions (Phase 24, round 7: docs/ui-design.md "Office shell"), for an
// admin or resourcer: places still to fill in sessions to come (Events & sessions' "open places"),
// those in urgent sessions (the dashboard's urgent places), and offers out with no reply yet (an
// offer's "waiting" state: offerStateSql, the dashboard's offers chart). The other two counts in the
// bar are the menu's own (Needs attention's and the pay queries waiting: office-menu.ts). Reads
// only, in one statement, through the firm's data layer; the same SQL as the pages the counts open,
// so they add up.

export interface ShellCounts {
  toFill: number;
  urgent: number;
  offersOut: number;
}

export async function loadShellCounts(tx: FirmTx, now: Date): Promise<ShellCounts> {
  const { rows } = await tx.execute<{ to_fill: number; urgent: number; offers_out: number }>(sql`
    select coalesce(sum(s.headcount - b.booked), 0)::int as to_fill,
           coalesce(sum(s.headcount - b.booked) filter (where ${urgentGap(now)}), 0)::int as urgent,
           (select count(*)::int
              from offers o
              join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
             where ${offerStateSql(now)} = 'waiting') as offers_out
      from shifts s
      ${bookedJoin}
     where ${placeFree(now)}
  `);
  const r = rows[0];
  return { toFill: r?.to_fill ?? 0, urgent: r?.urgent ?? 0, offersOut: r?.offers_out ?? 0 };
}

// The counts for the office user in `ctx`, or that they couldn't be read (the bar then shows each
// pill's words with no number); null for a role without Events & sessions (payroll).
export async function officeShellCounts(ctx: OfficeContext): Promise<Part<ShellCounts> | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) =>
    (await officeUserMay(tx, ctx.officeUserId, "shifts"))
      ? part(tx, "shell", (sp) => loadShellCounts(sp, now))
      : null,
  );
}
