import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { officeDashboard } from "@/lib/office/dashboard";
import { officePayQueriesWaiting } from "@/lib/office/pay-dashboard";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { page } from "../ui/classes";
import { DashboardContent } from "./dashboard-view";

// The office's first page: the dashboard for admins and resourcers (docs/office-v2.md 3.2, 3.9;
// docs/screens.md `/office`; Phase 18), with the firm's shifts line (its own number) under its
// headline, and pay queries waiting with payroll (admins; resourcers don't see pay). Payroll's
// home is the pay dashboard (`/office/pay`, 12A.3): they're sent there. The menu (with Needs
// attention, `/office/needs-attention`, and its count: Phase 20), the account menu and the session
// keeper are in the office shell (src/app/office/office-shell.tsx). `/office/today` redirects here.

export const metadata: Metadata = { title: "Dashboard" };

export default async function OfficeHome() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const [dashboard, line, waiting] = await Promise.all([
    officeDashboard({ firm, officeUserId: officeUser.id }),
    firmShiftsLine({ firm }),
    officePayQueriesWaiting({ firm }, officeUser.role),
  ]);
  if (!dashboard) notFound();
  return (
    <main className={page.office}>
      <DashboardContent
        d={dashboard}
        firmName={firm.name}
        now={new Date()}
        shiftsLine={shiftsLineText(line)}
        payQueriesWaiting={waiting ?? 0}
      />
    </main>
  );
}
