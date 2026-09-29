import { z } from "zod";
import { requireWorker } from "@/lib/auth/current-worker";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { openShiftsFor, type OpenShiftFilters } from "@/lib/portal/open-shifts";
import { OpenShiftsView } from "./open-shifts-view";

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
  const list = await openShiftsFor({ firm }, worker.id, filters);
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <OpenShiftsView list={list} filters={filters} timeZone={firm.timezone} now={new Date()} />
    </main>
  );
}
