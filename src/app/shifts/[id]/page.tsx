import Link from "next/link";
import { systemClock } from "@/lib/auth/clock";
import { requireWorker } from "@/lib/auth/current-worker";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { page as pageWidth, staffBtn } from "../../ui/classes";
import { ShiftView } from "./shift-view";
import { CasualTabBar } from "../../casual-tab-bar";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, worker, session } = await requireWorker();
  const { id } = await params;
  const now = systemClock.now();
  const page = await shiftForWorker({ firm, clock: { now: () => now } }, worker.id, id);
  return (
    <main className={pageWidth.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <ShiftView page={page} timeZone={firm.timezone} now={now} />
      <Link href="/" className={`${staffBtn.secondary} mt-8`}>
        Back to my shifts
      </Link>
      <CasualTabBar firm={firm} workerId={worker.id} current="shifts" />
    </main>
  );
}
