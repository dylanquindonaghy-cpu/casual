import Link from "next/link";
import { z } from "zod";
import { requireWorker } from "@/lib/auth/current-worker";
import { requestableShifts } from "@/lib/portal/requests";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { RequestForm } from "./request-form";

// New request (docs/screens.md, `/requests/new`): for one of the worker's upcoming shifts
// (?shift=<id> preselects it, when it's theirs).
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, worker, session } = await requireWorker();
  const shifts = await requestableShifts({ firm }, worker.id);
  const asked = z.uuid().safeParse((await searchParams).shift);
  const preselected =
    asked.success && shifts.some((s) => s.shiftId === asked.data) ? asked.data : null;
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <h1 className="text-3xl font-bold">New request</h1>
      {shifts.length === 0 ? (
        <p className="mt-6">You have no upcoming shifts to ask about.</p>
      ) : (
        <RequestForm shifts={shifts} preselected={preselected} />
      )}
      <Link
        href="/requests"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my requests
      </Link>
    </main>
  );
}
