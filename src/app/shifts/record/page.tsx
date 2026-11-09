import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/current-worker";
import { myRecord } from "@/lib/portal/my-record";
import { RECORD_TITLE } from "@/lib/portal/record-copy";
import { CasualTabBar } from "../../casual-tab-bar";
import { CasualTop } from "../../casual-top-bar";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { page } from "../../ui/classes";
import { RecordView } from "./record-view";

export const metadata: Metadata = { title: RECORD_TITLE };

// Your shift record (docs/screens.md "The casual app, Phase 28", 28.4; golden rule 12): her own
// offers, bookings, office changes and cancellations for the last 90 days, with the notice as it
// was logged. Hers only, by the worker id in her session (src/lib/portal/my-record.ts). Not kept
// for no signal: no OfflineCopy here, and public/sw.js keeps only Home and Booked, because her own
// cancellation's reason can be health information.
export default async function RecordPage() {
  const { firm, worker, session } = await requireWorker();
  const now = new Date();
  const record = await myRecord({ firm, clock: { now: () => now } }, worker.id);
  return (
    <>
      <CasualTop firm={firm} worker={worker} />
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <RecordView record={record} now={now} />
        <CasualTabBar firm={firm} workerId={worker.id} current="shifts" />
      </main>
    </>
  );
}
