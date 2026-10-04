import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { todayView } from "@/lib/office/today";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import { refreshOfficeSessionAction } from "./session-actions";
import { TodayContent } from "./today-view";

// The office dashboard: Today for admins and resourcers (docs/screens.md `/office/today`);
// payroll sees who they're logged in as, and the link to pay queries. Everyone sees the firm's
// shifts line (its own number), once it has one.
export default async function OfficeHome() {
  const { firm, officeUser, session } = await requireOfficeArea("dashboard");
  const today = canAccess(officeUser.role, "today")
    ? await todayView({ firm }, (await readSessionToken("office")) ?? "")
    : null;
  return (
    <main className={today ? "mx-auto max-w-4xl p-6" : "mx-auto max-w-2xl p-6"}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshOfficeSessionAction} />
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">{today ? "Today" : `Hello ${officeUser.name}`}</h1>
      {today && <p className="mt-1 text-lg">Hello {officeUser.name}</p>}
      <p className="mt-2">You&apos;re logged in as {ROLE_LABELS[officeUser.role]}.</p>
      <p className="mt-1">{shiftsLineText(await firmShiftsLine({ firm }))}</p>
      <nav className="mt-2 flex flex-wrap gap-4">
        {canAccess(officeUser.role, "shifts") && (
          <Link href="/office/shifts" className="underline">
            Shifts
          </Link>
        )}
        {canAccess(officeUser.role, "requests") && (
          <Link href="/office/requests" className="underline">
            Requests
          </Link>
        )}
        {canAccess(officeUser.role, "workers") && (
          <Link href="/office/workers" className="underline">
            Workers
          </Link>
        )}
        {canAccess(officeUser.role, "log") && (
          <Link href="/office/log" className="underline">
            Action log
          </Link>
        )}
        {canAccess(officeUser.role, "reports") && (
          <Link href="/office/reports/notice" className="underline">
            Notice report
          </Link>
        )}
        {canAccess(officeUser.role, "pilot") && (
          <Link href="/office/reports/pilot" className="underline">
            Pilot metrics
          </Link>
        )}
        {canAccess(officeUser.role, "pay") && (
          <Link href="/office/pay-queries" className="underline">
            Pay queries
          </Link>
        )}
        {canAccess(officeUser.role, "pay") && (
          <Link href="/office/pay/import" className="underline">
            Import pay records
          </Link>
        )}
        {canAccess(officeUser.role, "team") && (
          <Link href="/office/team" className="underline">
            Office team
          </Link>
        )}
        {canAccess(officeUser.role, "data") && (
          <Link href="/office/data" className="underline">
            Data requests (download or delete)
          </Link>
        )}
      </nav>
      {today ? (
        <TodayContent view={today} />
      ) : (
        <p className="mt-2">Your dashboard will appear here.</p>
      )}
      <LogoutButton kind="office" after="/office/login?out=1" />
    </main>
  );
}
