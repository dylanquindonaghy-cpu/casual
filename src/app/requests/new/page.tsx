import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { page, staffBtn } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker } from "@/lib/auth/current-worker";
import { requestableShifts } from "@/lib/portal/requests";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { RequestForm } from "./request-form";
import { CasualTabBar } from "../../casual-tab-bar";

export const metadata: Metadata = { title: "New request" };

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
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader eyebrow={firm.name} title="New request" />
      {shifts.length === 0 ? (
        <p>You have no upcoming shifts to ask about.</p>
      ) : (
        <RequestForm shifts={shifts} preselected={preselected} />
      )}
      <Link href="/requests" className={`${staffBtn.secondary} mt-8`}>
        Back to my requests
      </Link>
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
