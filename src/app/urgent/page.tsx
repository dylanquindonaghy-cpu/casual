import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/current-worker";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { page } from "../ui/classes";
import { UrgentView } from "./urgent-view";
import { CasualTabBar } from "../casual-tab-bar";

export const metadata: Metadata = { title: "Urgent shifts" };

export default async function UrgentPage() {
  const { firm, worker, session } = await requireWorker();
  const now = new Date();
  const list = await openShiftsFor({ firm, clock: { now: () => now } }, worker.id, {
    urgent: true,
  });
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <UrgentView list={list} timeZone={firm.timezone} now={now} />
      <CasualTabBar firm={firm} workerId={worker.id} current="shifts" />
    </main>
  );
}
