import { loadUpdatesBell, type UpdatesBell } from "./updates";
import { sql } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { canAccess, type OfficeArea, type OfficeRole } from "../auth/roles";
import type { FirmTx } from "../db/scoped";
import { localDateOf } from "../time/zoned";
import { waitingCount } from "./casuals";
import { firmFacts, loadNeedsAttention, part, type NeedsAttention, type Part } from "./dashboard";
import { needPersonCount } from "./enquiries";
import { parts, type OfficeContext } from "./office-context";
import { loadShellCounts, type ShellCounts } from "./shell-counts";
import { clientRequestCounts, type ClientRequestCounts } from "../client/queue";

// What every office page's frame shows (Phase 25.3, P4's "the layout's 5 reads in one
// transaction"): the menu's and the top bar's counts, read in one transaction for the office user
// in `ctx`, each for the roles that see it (null otherwise). Needs attention's items are read here
// in full, so its page uses these rather than reading them again (src/app/office/frame.ts holds
// one frame a request). A part that couldn't be read is said so (`Part`), and the rest still show.
export interface OfficeFrame {
  payQueries: Part<number> | null; // pay queries waiting (admins and payroll)
  uploads: Part<number> | null; // uploads waiting for a check (Casuals)
  needPerson: Part<number> | null; // enquiries that need a person (Enquiries)
  needs: { timeZone: string; today: string; needs: Part<NeedsAttention> } | null; // (dashboard)
  shell: Part<ShellCounts> | null; // the top bar's sessions (Events & sessions)
  updates: Part<UpdatesBell> | null; // the bell and the pop-up (Phase 26.4: admins, resourcers)
  // The top bar's "Client requests N" (Phase 36.4): waiting for the office, urgent ones, and the
  // planner's to-dos, the firm's (admins and resourcers).
  clientRequests: Part<ClientRequestCounts> | null;
}

const NO_FRAME: OfficeFrame = {
  payQueries: null,
  uploads: null,
  needPerson: null,
  needs: null,
  shell: null,
  updates: null,
  clientRequests: null,
};

export async function loadOfficeFrame(ctx: OfficeContext): Promise<OfficeFrame> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx): Promise<OfficeFrame> => {
    // The office user's role as it is now: one read for every part (an account switched off since
    // its session began sees none).
    const { rows } = await tx.execute<{ role: OfficeRole }>(sql`
      select role from office_users where id = ${ctx.officeUserId} and status = 'active'
    `);
    const role = rows[0]?.role;
    if (!role) return NO_FRAME;
    const may = (area: OfficeArea) => canAccess(role, area);
    return {
      payQueries: may("pay") ? await part(tx, "pay-queries", payQueriesWaiting) : null,
      uploads: may("casuals") ? await part(tx, "uploads", waitingCount) : null,
      needPerson: may("enquiries")
        ? await part(tx, "need-person", (sp) => needPersonCount(sp, now))
        : null,
      needs: may("today") ? await needsOf(tx, now) : null,
      shell: may("shifts") ? await part(tx, "shell", (sp) => loadShellCounts(sp, now)) : null,
      updates: may("today")
        ? await part(tx, "updates bell", (sp) => loadUpdatesBell(sp, now, ctx.officeUserId))
        : null,
      clientRequests: may("client_requests")
        ? await part(tx, "client requests", (sp) => clientRequestCounts(sp, now))
        : null,
    };
  });
}

// The pay queries waiting for payroll: open, or in a digest not yet answered.
async function payQueriesWaiting(tx: FirmTx): Promise<number> {
  const { rows } = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from pay_queries where status in ('open', 'in_digest')`,
  );
  return rows[0]?.n ?? 0;
}

async function needsOf(tx: FirmTx, now: Date): Promise<NonNullable<OfficeFrame["needs"]>> {
  const { timeZone } = await firmFacts(tx);
  return {
    timeZone,
    today: localDateOf(now, timeZone),
    needs: await part(tx, "needs", (sp) => loadNeedsAttention(sp, now, timeZone)),
  };
}
