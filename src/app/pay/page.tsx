import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { hasLiveCode } from "@/lib/auth/step-up";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { myPay, StepUpRequiredError, type PayLine } from "@/lib/portal/pay";
import { myPayQueries, type MyPayQuery } from "@/lib/portal/pay-queries";
import { CodeGate } from "./code-gate";
import { PayQueries, PayView } from "./pay-view";
import { CasualTabBar } from "../casual-tab-bar";

export const metadata: Metadata = { title: "Your pay" };

// Pay (docs/screens.md): behind a 6-digit code, valid for 30 minutes. Then the imported pay
// records, loaded only for a stepped-up session (steppedUpWorker(), and myPay() checks again).
export default async function PayPage() {
  const { firm, worker, session } = await requireWorker();
  const stepped = await steppedUpWorker();
  // myPay checks the code window again; if it ran out a moment ago, the code gate shows.
  const lines: PayLine[] | null = stepped
    ? await myPay({ firm }, stepped).catch((err: unknown) => {
        if (err instanceof StepUpRequiredError) return null;
        throw err;
      })
    : null;
  const queries: MyPayQuery[] | null =
    stepped && lines
      ? await myPayQueries({ firm }, stepped).catch((err: unknown) => {
          if (err instanceof StepUpRequiredError) return null;
          throw err;
        })
      : null;
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader title="Pay" />
      {lines ? (
        <>
          <PayView lines={lines} firmName={firm.name} />
          {queries && <PayQueries queries={queries} />}
        </>
      ) : (
        <CodeGate codeWaiting={await hasLiveCode({ firm }, session)} />
      )}
      <CasualTabBar firm={firm} workerId={worker.id} current="pay" />
    </main>
  );
}
