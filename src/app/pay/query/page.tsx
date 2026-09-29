import Link from "next/link";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { payQueryShifts, type PayQueryShift } from "@/lib/portal/pay-queries";
import { addDays, localDateOf } from "@/lib/time/zoned";
import { PAY_QUERY_DAYS_BACK } from "@/lib/portal/pay-query-kinds";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { PayQueryForm } from "./pay-query-form";

const secondary =
  "mt-6 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold";

// "Raise a pay query" (docs/screens.md `/pay/query`): behind the pay code, like the pay figures.
// Without a code from the last 30 minutes, it points back to the pay page for one.
export default async function PayQueryPage() {
  const { firm, session } = await requireWorker();
  const stepped = await steppedUpWorker();
  const today = localDateOf(new Date(), firm.timezone);
  const shifts: PayQueryShift[] | null = stepped
    ? await payQueryShifts({ firm }, stepped).catch((err: unknown) => {
        if (err instanceof StepUpRequiredError) return null;
        throw err;
      })
    : null;
  return (
    <main className="mx-auto max-w-md p-6">
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <p className="text-base text-slate-600">{firm.name}</p>
      <h1 className="text-3xl font-bold">Raise a pay query</h1>
      {shifts ? (
        <>
          <p className="mt-2">
            Payroll will look at it. You&apos;ll see its status on your pay page.
          </p>
          <PayQueryForm
            shifts={shifts.map((s) => ({ shiftId: s.shiftId, label: s.label }))}
            today={today}
            earliest={addDays(today, -PAY_QUERY_DAYS_BACK)}
          />
        </>
      ) : (
        <>
          <p className="mt-4">To keep your pay private, enter your pay code first.</p>
          <Link href="/pay" className={secondary}>
            Go to your pay
          </Link>
        </>
      )}
    </main>
  );
}
