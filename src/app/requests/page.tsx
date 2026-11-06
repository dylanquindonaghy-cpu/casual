import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { requireWorker } from "@/lib/auth/current-worker";
import { canWithdrawRequest, myRequests } from "@/lib/portal/requests";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { AnswersSeen } from "./answers-seen";
import { RequestsList } from "./requests-list";
import { CasualTabBar } from "../casual-tab-bar";

export const metadata: Metadata = { title: "My requests" };

// My requests (docs/screens.md `/requests`, "### 28.9"). Making the page only reads: her
// requests, and whether each can be taken back (canWithdrawRequest, worked out here so the list,
// a client part, never reaches the database code). Her answers are marked seen by AnswersSeen once
// the list is on her screen, never here, so a prefetch can't clear the count.
export default async function RequestsPage() {
  const { firm, worker, session } = await requireWorker();
  const shownAt = new Date().toISOString();
  const requests = await myRequests({ firm }, worker.id);
  const rows = requests.map((r) => ({ ...r, canTakeBack: canWithdrawRequest(r) }));
  const answered = requests.some((r) => r.status === "approved" || r.status === "declined");
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <RequestsList requests={rows} timeZone={firm.timezone} />
      {answered && <AnswersSeen shownAt={shownAt} />}
      <CasualTabBar firm={firm} workerId={worker.id} current="profile" />
    </main>
  );
}
