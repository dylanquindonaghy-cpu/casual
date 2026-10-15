import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { officeDashboard } from "@/lib/office/dashboard";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { meta, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { DashboardContent } from "./dashboard-view";

// The office's first page: the dashboard for admins and resourcers (docs/office-v2.md 3.2, 3.9;
// docs/screens.md `/office`), with the firm's shifts line (its own number) under the heading.
// Payroll's home is the pay dashboard (`/office/pay`, 12A.3): they're sent there. The menu, the
// bell, the account menu and the session keeper are in the office shell
// (src/app/office/office-shell.tsx), on every office page. `/office/today` redirects here.

export const metadata: Metadata = { title: "Dashboard" };

export default async function OfficeHome() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const dashboard = await officeDashboard({ firm, officeUserId: officeUser.id });
  if (!dashboard) notFound();
  return (
    <main className={page.office}>
      <PageHeader eyebrow={`${firm.name} office`} title="Dashboard">
        <p className={meta}>{shiftsLineText(await firmShiftsLine({ firm }))}</p>
      </PageHeader>
      <DashboardContent d={dashboard} isAdmin={officeUser.role === "admin"} />
    </main>
  );
}
