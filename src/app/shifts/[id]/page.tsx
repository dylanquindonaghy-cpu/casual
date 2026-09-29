import Link from "next/link";
import { systemClock } from "@/lib/auth/clock";
import { requireWorker } from "@/lib/auth/current-worker";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { ShiftView } from "./shift-view";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, worker, session } = await requireWorker();
  const { id } = await params;
  const now = systemClock.now();
  const page = await shiftForWorker({ firm, clock: { now: () => now } }, worker.id, id);
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <ShiftView page={page} timeZone={firm.timezone} now={now} />
      <Link
        href="/"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my shifts
      </Link>
    </main>
  );
}
