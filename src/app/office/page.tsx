import Link from "next/link";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { todayView } from "@/lib/office/today";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import { officeLogoutAction, refreshOfficeSessionAction } from "./session-actions";
import { TodayContent } from "./today-view";

// The office dashboard: Today for admins and resourcers (docs/screens.md `/office/today`);
// payroll sees who they're logged in as (their pay queries screen comes in Phase 6).
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
        {canAccess(officeUser.role, "log") && (
          <Link href="/office/log" className="underline">
            Action log
          </Link>
        )}
        {canAccess(officeUser.role, "team") && (
          <Link href="/office/team" className="underline">
            Office team
          </Link>
        )}
      </nav>
      {today ? (
        <TodayContent view={today} />
      ) : (
        <p className="mt-2">Your dashboard will appear here.</p>
      )}
      <LogoutButton action={officeLogoutAction} after="/office/login?out=1" />
    </main>
  );
}
