import Link from "next/link";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { hasLiveCode } from "@/lib/auth/step-up";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { myPay, StepUpRequiredError, type PayLine } from "@/lib/portal/pay";
import { myPayQueries, type MyPayQuery } from "@/lib/portal/pay-queries";
import { CodeGate } from "./code-gate";
import { PayQueries, PayView } from "./pay-view";

// Pay (docs/screens.md): behind a 6-digit code, valid for 30 minutes. Then the imported pay
// records, loaded only for a stepped-up session (steppedUpWorker(), and myPay() checks again).
export default async function PayPage() {
  const { firm, session } = await requireWorker();
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
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <h1 className="text-3xl font-bold">Your pay</h1>
      {lines ? (
        <>
          <PayView lines={lines} firmName={firm.name} />
          {queries && <PayQueries queries={queries} />}
        </>
      ) : (
        <CodeGate codeWaiting={await hasLiveCode({ firm }, session)} />
      )}
      <Link href="/" className="mt-8 inline-block underline">
        Back to my shifts
      </Link>
    </main>
  );
}
