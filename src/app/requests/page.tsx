import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { myRequests } from "@/lib/portal/requests";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { RequestsList } from "./requests-list";
import { CasualTabBar } from "../casual-tab-bar";

export const metadata: Metadata = { title: "My requests" };

export default async function RequestsPage() {
  const { firm, worker, session } = await requireWorker();
  const requests = await myRequests({ firm }, worker.id);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <RequestsList requests={requests} timeZone={firm.timezone} />
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
