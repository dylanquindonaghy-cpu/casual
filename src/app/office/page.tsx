import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { boardShow, officeDashboard } from "@/lib/office/dashboard-board";
import { page } from "../ui/classes";
import { DashboardContent } from "./dashboard-view";

// The office's first page: the dashboard for admins and resourcers (Phase 24, 24.3; docs/screens.md
// `/office`). `?show=` is the track's filter (urgent, this-week, next-week; anything else is All)
// and `?session=` the session the detail card shows (one with a place free; else the page
// chooses). Payroll's home is the pay dashboard (`/office/pay`, 12A.3): they're sent there. The
// menu, the top bar's counts, the account menu and the session keeper are the office shell's
// (src/app/office/office-shell.tsx). `/office/today` redirects here.

export const metadata: Metadata = { title: "Dashboard" };

export default async function OfficeHome({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; session?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  if (!canAccess(officeUser.role, "today")) redirect("/office/pay");
  const { show, session } = await searchParams;
  const board = await officeDashboard(
    { firm, officeUserId: officeUser.id },
    { show: boardShow(show), session: session ?? null },
  );
  if (!board) notFound();
  return (
    <main className={page.office}>
      <DashboardContent board={board} />
    </main>
  );
}
