import type { Metadata } from "next";
import { page } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireWorker, steppedUpWorker } from "@/lib/auth/current-worker";
import { hasLiveCode } from "@/lib/auth/step-up";
import { workerLoginWay } from "@/lib/portal/login-way";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { PAY_CODE } from "@/lib/portal/pay-copy";
import { payQueryShifts, type PayQueryShift } from "@/lib/portal/pay-queries";
import { addDays, localDateOf } from "@/lib/time/zoned";
import { PAY_QUERY_DAYS_BACK, payQueryPath, preselectedShift } from "@/lib/portal/pay-query-kinds";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { CodeGate } from "../code-gate";
import { PayQueryForm } from "./pay-query-form";
import { CasualTabBar } from "../../casual-tab-bar";

export const metadata: Metadata = { title: "Raise a pay query" };

// "Raise a pay query" (docs/screens.md `/pay/query`, "### 28.10"): behind the pay code, like the pay
// figures. Without a code from the last 30 minutes, the code step is on this page (Phase 28.10: the
// pay page's own step, the same limits and window) and a right code comes back here: to
// payQueryPath, this page's fixed path with ?shift= kept only when it's a shift's id. Nothing else
// in the address is read, so it can't send her anywhere else. ?shift= chooses one of her own shifts
// in the form (preselectedShift: only one from her list, her own in her firm; else ignored).
export default async function PayQueryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, worker, session } = await requireWorker();
  const { shift: rawShift } = await searchParams;
  const stepped = await steppedUpWorker();
  const today = localDateOf(new Date(), firm.timezone);
  const returnTo = payQueryPath(rawShift);
  const shifts: PayQueryShift[] | null = stepped
    ? await payQueryShifts({ firm }, stepped).catch((err: unknown) => {
        if (err instanceof StepUpRequiredError) return null;
        throw err;
      })
    : null;
  // Without the code: how it can come, and whether one sent earlier still works (as on Pay).
  const gate = shifts
    ? null
    : {
        way: await workerLoginWay(firm.id, worker.id),
        codeWaiting: await hasLiveCode({ firm }, session),
      };
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <PageHeader title="Raise a pay query">
        {!gate ? (
          <p>Payroll will look at it. You&apos;ll see its status on your pay page.</p>
        ) : gate.way !== "off" ? (
          <p>{PAY_CODE.queryIntro}</p>
        ) : null}
      </PageHeader>
      {gate ? (
        <CodeGate
          codeWaiting={gate.codeWaiting}
          way={gate.way}
          purpose="query"
          returnTo={returnTo}
        />
      ) : (
        <PayQueryForm
          shifts={(shifts ?? []).map((s) => ({ shiftId: s.shiftId, label: s.label }))}
          preselected={preselectedShift(shifts ?? [], rawShift)}
          today={today}
          earliest={addDays(today, -PAY_QUERY_DAYS_BACK)}
          codeStep={returnTo}
        />
      )}
      <CasualTabBar firm={firm} workerId={worker.id} current="pay" />
    </main>
  );
}
