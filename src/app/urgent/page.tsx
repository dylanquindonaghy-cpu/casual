import { requireWorker } from "@/lib/auth/current-worker";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { UrgentView } from "./urgent-view";

export default async function UrgentPage() {
  const { firm, worker, session } = await requireWorker();
  const now = new Date();
  const list = await openShiftsFor({ firm, clock: { now: () => now } }, worker.id, {
    urgent: true,
  });
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <UrgentView list={list} timeZone={firm.timezone} now={now} />
    </main>
  );
}
