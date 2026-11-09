import { eq } from "drizzle-orm";
import { systemClock } from "../auth/clock";
import { withFirm } from "../db/scoped";
import { workers } from "../db/schema";
import { localDateOf } from "../time/zoned";
import { roleLabel } from "./format";
import { countPills, toDoCount, type CountPill } from "./home-board";
import { urgentCount } from "./my-home";
import { myNeedsAndPhoto, myShiftCounts, type PortalContext } from "./my-shifts";
import { openShiftsNow } from "./request-cached";
import { mySortedMark } from "./profile";
import { myReachPrompts } from "./reach-me";
import type { TabCounts } from "./tab-counts";

// The casual app's top bar (Phase 32, 32.1; docs/screens.md "## Phase 32"), as the office's: her
// count pills, the bell and her name and role. Every number is the one Home's counts already show,
// read through the same loaders (golden rule 1: code decides, from her own rows, inside her firm):
// Booked as /shifts counts her bookings, Open to you as /shifts/open lists the shifts she can take
// (openShiftsFor: the rules' own list, never a second one), Urgent as /urgent counts them, To do
// what Home's "Do this" stands for, Messages the office's replies she hasn't read (the tab bar's).
// Home passes the pills it has already worked out (barPillsFor), so nothing is read twice there.
// Server only.

type Ctx = PortalContext & { firm: { id: string; timezone: string } };

// In the bar every page links "To do" to Home's "Do this" (on Home itself too: the same place).
export const TODO_HREF = "/#do-this-heading";
export const barPills = (pills: CountPill[]): CountPill[] =>
  pills.map((p) => (p.key === "todo" ? { ...p, href: TODO_HREF } : p));

// Her role as the bar names it under her name ("Steward"): her first role, in words; null when
// she has none on file.
export const barRole = (roles: readonly string[]): string | null =>
  roles.length > 0 ? roleLabel(roles[0]!) : null;

export async function myBarRole(ctx: PortalContext, workerId: string): Promise<string | null> {
  const run = ctx.run ?? withFirm;
  const [row] = await run(ctx.firm.id, (tx) =>
    tx.select({ roles: workers.roles }).from(workers).where(eq(workers.id, workerId)),
  );
  return barRole(row?.roles ?? []);
}

// The pills on a page other than Home, read as Home reads them.
export async function barPillsFor(
  ctx: Ctx,
  workerId: string,
  counts: TabCounts,
): Promise<CountPill[]> {
  const now = (ctx.clock ?? systemClock).now();
  const clock = { now: () => now };
  const c = { ...ctx, clock };
  const [booked, open, held, mark, reach] = await Promise.all([
    myShiftCounts(c, workerId),
    // The page's own unfiltered list, once per request (Open shifts reads the same one).
    openShiftsNow(ctx.firm.id, workerId),
    myNeedsAndPhoto(c, workerId),
    mySortedMark(c, workerId),
    myReachPrompts(c, workerId),
  ]);
  const urgent = await urgentCount(c, workerId, open);
  const year = Number(localDateOf(now, ctx.firm.timezone).slice(0, 4));
  return barPills(
    countPills({
      booked: booked.upcoming,
      open: open.shifts.length,
      urgent,
      todo: toDoCount({ needs: held.needs, photo: held.photo, year, sortedMark: mark, reach }),
      messages: counts.replies,
    }),
  );
}
