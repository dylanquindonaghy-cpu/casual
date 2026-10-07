import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getOfficeSession } from "@/lib/auth/current-office";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { officePayQueriesWaiting } from "@/lib/office/pay-dashboard";
import { payWeekLabel, payWeekNow } from "@/lib/pay/pay-week";
import { THEME_COOKIE, themeFromCookie } from "../theme";
import { OfficeShell, officeMenu } from "./office-shell";

// Every office page sits in the office shell (the top bar, the menu, the account menu) once
// someone is logged in. With no session (/office/login, /office/l, or a page that's about to send
// you to log in) the page shows on its own. Display only, so it never redirects or hides a page:
// each page checks its own access (requireOfficeArea), and each action its own.
export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const s = await getOfficeSession();
  if (!s) return <>{children}</>;
  // The Pay queries badge: how many are waiting (admins and payroll).
  const waiting = await officePayQueriesWaiting({ firm: s.firm }, s.officeUser.role);
  const badges = waiting
    ? { "/office/pay-queries": { count: waiting, words: `${waiting} waiting` } }
    : {};
  return (
    <OfficeShell
      name={s.officeUser.name}
      roleLabel={ROLE_LABELS[s.officeUser.role]}
      firmName={s.firm.name}
      payWeek={payWeekLabel(payWeekNow(new Date(), s.firm.timezone))}
      menu={officeMenu(s.officeUser.role, badges)}
      theme={themeFromCookie((await cookies()).get(THEME_COOKIE)?.value)}
      rotationDue={s.session.rotationDue}
    >
      {children}
    </OfficeShell>
  );
}
