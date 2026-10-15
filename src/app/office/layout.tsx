import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { uploadsToCheck } from "@/lib/office/casuals";
import { needsAttentionBell } from "@/lib/office/dashboard";
import { bellLabel } from "@/lib/office/dashboard-copy";
import { enquiriesWaiting } from "@/lib/office/enquiries";
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
  // The Casuals badge: uploads waiting for a check (admins and resourcers; 12F.2).
  const toCheck = canAccess(s.officeUser.role, "casuals")
    ? await uploadsToCheck({ firm: s.firm, officeUserId: s.officeUser.id })
    : null;
  // The Enquiries badge: messages that need a person (admins and resourcers; 12D.1).
  const needPerson = canAccess(s.officeUser.role, "enquiries")
    ? await enquiriesWaiting({ firm: s.firm, officeUserId: s.officeUser.id })
    : null;
  // The bell: Needs attention's items (admins and resourcers; 12E.1).
  const needs = canAccess(s.officeUser.role, "today")
    ? await needsAttentionBell({ firm: s.firm, officeUserId: s.officeUser.id })
    : null;
  const bell = needs
    ? {
        label: bellLabel(needs.count, needs.more),
        shown:
          needs.count === null || needs.count === 0
            ? null
            : needs.more
              ? `${needs.count}+`
              : String(needs.count),
      }
    : null;
  const badges = {
    ...(waiting ? { "/office/pay-queries": { count: waiting, words: `${waiting} waiting` } } : {}),
    ...(needPerson
      ? { "/office/enquiries": { count: needPerson, words: `${needPerson} need a person` } }
      : {}),
    ...(toCheck ? { "/office/casuals": { count: toCheck, words: `${toCheck} to check` } } : {}),
  };
  return (
    <OfficeShell
      name={s.officeUser.name}
      roleLabel={ROLE_LABELS[s.officeUser.role]}
      firmName={s.firm.name}
      payWeek={payWeekLabel(payWeekNow(new Date(), s.firm.timezone))}
      menu={officeMenu(s.officeUser.role, badges)}
      theme={themeFromCookie((await cookies()).get(THEME_COOKIE)?.value)}
      rotationDue={s.session.rotationDue}
      bell={bell}
    >
      {children}
    </OfficeShell>
  );
}
