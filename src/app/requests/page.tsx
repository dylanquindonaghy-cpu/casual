import { requireWorker } from "@/lib/auth/current-worker";
import { myRequests } from "@/lib/portal/requests";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { RequestsList } from "./requests-list";

export default async function RequestsPage() {
  const { firm, worker, session } = await requireWorker();
  const requests = await myRequests({ firm }, worker.id);
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <RequestsList requests={requests} timeZone={firm.timezone} />
    </main>
  );
}
