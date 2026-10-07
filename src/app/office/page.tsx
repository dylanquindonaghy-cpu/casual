import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { todayView } from "@/lib/office/today";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { meta, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { TodayContent } from "./today-view";

// The office's first page: Today for admins and resourcers (docs/screens.md `/office/today`), with
// the firm's shifts line (its own number) once it has one. Payroll's home is the pay dashboard
// (`/office/pay`, 12A.3): they're sent there. The menu, the account menu and the session keeper
// are in the office shell (src/app/office/office-shell.tsx), on every office page.

export const metadata: Metadata = { title: "Today" };

export default async function OfficeHome() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const today = await todayView({ firm }, (await readSessionToken("office")) ?? "");
  if (!today) notFound();
  const whoAndLine = (
    <div className="flex flex-col gap-0.5">
      <p className={meta}>You&apos;re logged in as {ROLE_LABELS[officeUser.role]}.</p>
      <p className={meta}>{shiftsLineText(await firmShiftsLine({ firm }))}</p>
    </div>
  );
  return (
    <main className={page.office}>
      <PageHeader eyebrow={`${firm.name} office`} title="Today">
        <p className="text-lg text-ink">Hello {officeUser.name}</p>
        {whoAndLine}
      </PageHeader>
      <TodayContent view={today} />
    </main>
  );
}
