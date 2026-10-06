import type { Metadata } from "next";
import { getOfficeSession, requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { todayView } from "@/lib/office/today";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { card, meta, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { TodayContent } from "./today-view";

// The office dashboard: Today for admins and resourcers (docs/screens.md `/office/today`);
// payroll sees who they're logged in as. Everyone sees the firm's shifts line (its own number),
// once it has one. The menu, "Log out" and the session keeper are in the office shell
// (src/app/office/office-shell.tsx), on every office page.

// The browser tab says which page this is: "Today", or "Home" for payroll (the menu's names).
export async function generateMetadata(): Promise<Metadata> {
  const session = await getOfficeSession();
  if (!session) return {};
  return { title: canAccess(session.officeUser.role, "today") ? "Today" : "Home" };
}

export default async function OfficeHome() {
  const { firm, officeUser } = await requireOfficeArea("dashboard");
  const today = canAccess(officeUser.role, "today")
    ? await todayView({ firm }, (await readSessionToken("office")) ?? "")
    : null;
  const whoAndLine = (
    <div className="flex flex-col gap-0.5">
      <p className={meta}>You&apos;re logged in as {ROLE_LABELS[officeUser.role]}.</p>
      <p className={meta}>{shiftsLineText(await firmShiftsLine({ firm }))}</p>
    </div>
  );
  return (
    <main className={page.office}>
      <PageHeader
        eyebrow={`${firm.name} office`}
        title={today ? "Today" : `Hello ${officeUser.name}`}
      >
        {today && <p className="text-lg text-ink">Hello {officeUser.name}</p>}
        {whoAndLine}
      </PageHeader>
      {today ? (
        <TodayContent view={today} />
      ) : (
        <p className={`${card} max-w-2xl text-ink-muted`}>Your dashboard will appear here.</p>
      )}
    </main>
  );
}
