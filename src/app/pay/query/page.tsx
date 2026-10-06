import type { Metadata } from "next";
import Link from "next/link";
import { page, staffBtn } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { payQueryShifts, type PayQueryShift } from "@/lib/portal/pay-queries";
import { addDays, localDateOf } from "@/lib/time/zoned";
import { PAY_QUERY_DAYS_BACK } from "@/lib/portal/pay-query-kinds";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { PayQueryForm } from "./pay-query-form";

export const metadata: Metadata = { title: "Raise a pay query" };

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
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader eyebrow={firm.name} title="Raise a pay query">
        {shifts ? (
          <p>Payroll will look at it. You&apos;ll see its status on your pay page.</p>
        ) : null}
      </PageHeader>
      {shifts ? (
        <PayQueryForm
          shifts={shifts.map((s) => ({ shiftId: s.shiftId, label: s.label }))}
          today={today}
          earliest={addDays(today, -PAY_QUERY_DAYS_BACK)}
        />
      ) : (
        <>
          <p>To keep your pay private, enter your pay code first.</p>
          <Link href="/pay" className={`${staffBtn.primary} mt-6`}>
            Go to your pay
          </Link>
        </>
      )}
    </main>
  );
}
