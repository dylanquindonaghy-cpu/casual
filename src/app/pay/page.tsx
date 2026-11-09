import type { Metadata } from "next";
import { page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { hasLiveCode } from "@/lib/auth/step-up";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { myPay, StepUpRequiredError, type PayLine } from "@/lib/portal/pay";
import { myPayDay } from "@/lib/portal/pay-day";
import { myPayQueries, type MyPayQuery } from "@/lib/portal/pay-queries";
import { unseenPayAnswers } from "@/lib/portal/request-answers";
import { workerLoginWay } from "@/lib/portal/login-way";
import { CodeGate } from "./code-gate";
import { PayDayCard, PayQueries, PayView } from "./pay-view";
import { CasualTabBar } from "../casual-tab-bar";
import { CasualTop } from "../casual-top-bar";

export const metadata: Metadata = { title: "Your pay" };

// Pay (docs/screens.md `/pay`, "### 28.10"): the pay day first, for everyone (Home shows the same
// day without a code: Phase 28.10), then a 6‑digit code, valid for 30 minutes. Then the imported pay
// records, loaded only for a stepped-up session (steppedUpWorker(), and myPay() checks again), and
// her pay queries, payroll's answers among them: those she hasn't seen are marked seen by an action
// once one is on her screen (PayAnswersSeen), never by this page rendering.
export default async function PayPage() {
  const { firm, worker, session } = await requireWorker();
  const now = new Date();
  const clock = { now: () => now };
  const stepped = await steppedUpWorker();
  const payDay = <PayDayCard pay={await myPayDay({ firm, clock }, worker.id)} />;
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
  // Only whether there are any (a number, never what payroll said), so the page knows to watch.
  const newAnswers = queries ? (await unseenPayAnswers({ firm, clock }, worker.id)) > 0 : false;
  return (
    <>
      <CasualTop firm={firm} worker={worker} />
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <PageHeader title="Pay" />
        {lines ? (
          <>
            <PayView lines={lines} firmName={firm.name} payDay={payDay} />
            {queries && (
              <PayQueries queries={queries} newAnswers={newAnswers} shownAt={now.toISOString()} />
            )}
          </>
        ) : (
          <>
            {payDay}
            <CodeGate
              codeWaiting={await hasLiveCode({ firm }, session)}
              way={await workerLoginWay(firm.id, worker.id)}
              className={sectionGap.staff}
            />
          </>
        )}
        <CasualTabBar firm={firm} workerId={worker.id} current="pay" />
      </main>
    </>
  );
}
