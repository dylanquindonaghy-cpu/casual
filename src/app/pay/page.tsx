import Link from "next/link";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { hasLiveCode } from "@/lib/auth/step-up";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { CodeGate } from "./code-gate";

// Pay (docs/screens.md): behind a 6-digit code, valid for 30 minutes. The pay figures themselves
// arrive in Phase 3 (imported pay records), loaded only through steppedUpWorker().
export default async function PayPage() {
  const { firm, session } = await requireWorker();
  const open = await steppedUpWorker();
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <h1 className="text-3xl font-bold">Your pay</h1>
      {open ? (
        <p className="mt-4">Your hours, rates and pay dates will appear here.</p>
      ) : (
        <CodeGate codeWaiting={await hasLiveCode({ firm }, session)} />
      )}
      <Link href="/" className="mt-8 inline-block underline">
        Back to my shifts
      </Link>
    </main>
  );
}
