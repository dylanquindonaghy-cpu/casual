import { systemClock } from "@/lib/auth/clock";
import { requireWorker } from "@/lib/auth/current-worker";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { page as pageWidth } from "../../ui/classes";
import { ShiftView } from "./shift-view";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, worker, session } = await requireWorker();
  const { id } = await params;
  const now = systemClock.now();
  const page = await shiftForWorker({ firm, clock: { now: () => now } }, worker.id, id);
  return (
    <main className={pageWidth.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <ShiftView page={page} timeZone={firm.timezone} now={now} />
    </main>
  );
}
