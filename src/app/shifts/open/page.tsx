import type { Metadata } from "next";
import { z } from "zod";
import { requireWorker } from "@/lib/auth/current-worker";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { page } from "../../ui/classes";
import { myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor, type OpenShiftFilters } from "@/lib/portal/open-shifts";
import { shiftsStrip } from "@/lib/portal/shifts-strip";
import { localDateOf } from "@/lib/time/zoned";
import { OpenShiftsView } from "./open-shifts-view";
import { CasualTabBar } from "../../casual-tab-bar";

export const metadata: Metadata = { title: "Open shifts" };

// Filters come from the address (?day=&site=&role=); anything that doesn't look right is ignored.
const filtersSchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  site: z.uuid().optional().catch(undefined),
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(100)
    .optional()
    .catch(undefined),
});

export default async function OpenShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, worker, session } = await requireWorker();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const parsed = filtersSchema.parse({
    day: one(raw.day),
    site: one(raw.site),
    role: one(raw.role),
  });
  const filters: OpenShiftFilters = { day: parsed.day, siteId: parsed.site, role: parsed.role };
  const now = new Date();
  const clock = { now: () => now };
  const filtered = !!(filters.day || filters.siteId || filters.role);
  // The strip counts every open shift in the next 8 days, whatever the list is filtered to, and
  // marks the days she's booked.
  const [list, all, booked] = await Promise.all([
    openShiftsFor({ firm, clock }, worker.id, filters),
    filtered ? openShiftsFor({ firm, clock }, worker.id, {}) : null,
    myShifts({ firm, clock }, worker.id, "upcoming"),
  ]);
  const strip = shiftsStrip(
    now,
    firm.timezone,
    (all ?? list).shifts,
    booked.map((b) => localDateOf(b.startsAt, firm.timezone)),
  );
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <OpenShiftsView
        list={list}
        filters={filters}
        strip={strip}
        timeZone={firm.timezone}
        now={now}
      />
      <CasualTabBar firm={firm} workerId={worker.id} current="shifts" />
    </main>
  );
}
