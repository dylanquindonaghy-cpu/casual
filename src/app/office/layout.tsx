import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { uploadsToCheck } from "@/lib/office/casuals";
import { needsAttentionBell } from "@/lib/office/dashboard";
import { enquiriesWaiting } from "@/lib/office/enquiries";
import { officePayQueriesWaiting } from "@/lib/office/pay-dashboard";
import { officeShellCounts } from "@/lib/office/shell-counts";
import { THEME_COOKIE, themeFromCookie } from "../theme";
import { barCounts, menuBadges, OfficeShell, officeMenu } from "./office-shell";
import { RAIL_COOKIE, railOpenFromCookie } from "./rail-cookie";

// Every office page sits in the office shell (the rail or the drawer, the top bar with its counts and
// search, the account menu) once someone is logged in. With no session (/office/login, /office/l, or a page that's about to send
// you to log in) the page shows on its own. Display only, so it never redirects or hides a page:
// each page checks its own access (requireOfficeArea), and each action its own.
// Either way the page is wrapped in [data-office] (Phase 21): the office's sizes (globals.css; since
// Phase 24 its colours, glass and face are the app's own). The wrapper draws no box of its own
// (contents).
function OfficeLook({ children }: { children: ReactNode }) {
  return (
    <div data-office="" className="contents">
      {children}
    </div>
  );
}

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const s = await getOfficeSession();
  if (!s) return <OfficeLook>{children}</OfficeLook>;
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
  // Needs attention's count in the menu (admins and resourcers; 12E.1, the bell's until Phase 20):
  // its items and the enquiries that need a person, the one count the dashboard's headline uses.
  const needs = canAccess(s.officeUser.role, "today")
    ? await needsAttentionBell({ firm: s.firm, officeUserId: s.officeUser.id })
    : null;
  const attention =
    needs && needs.count !== null
      ? { count: needs.count + (needPerson ?? 0), more: needs.more }
      : null;
  // The top bar's counts of sessions (Phase 24): places to fill, urgent places, offers out (admins
  // and resourcers).
  const shell = canAccess(s.officeUser.role, "shifts")
    ? await officeShellCounts({ firm: s.firm, officeUserId: s.officeUser.id })
    : null;
  // Pale yellow when it needs this person (Phases 18 and 20; office-menu.ts menuBadges).
  const badges = menuBadges(s.officeUser.role, {
    payQueries: waiting ?? 0,
    needPerson: needPerson ?? 0,
    uploads: toCheck ?? 0,
    attention,
  });
  const jar = await cookies();
  return (
    <OfficeLook>
      <OfficeShell
        name={s.officeUser.name}
        roleLabel={ROLE_LABELS[s.officeUser.role]}
        firmName={s.firm.name}
        menu={officeMenu(s.officeUser.role, badges)}
        counts={barCounts(s.officeUser.role, {
          shell: shell?.ok ? shell.data : null,
          // Needs attention's one count, as the menu's (null: it couldn't be read).
          attention: needs
            ? { count: attention?.count ?? null, more: attention?.more ?? false }
            : null,
          payQueries: waiting,
        })}
        canSearch={
          canAccess(s.officeUser.role, "casuals") || canAccess(s.officeUser.role, "shifts")
        }
        railOpen={railOpenFromCookie(jar.get(RAIL_COOKIE)?.value)}
        theme={themeFromCookie(jar.get(THEME_COOKIE)?.value)}
        rotationDue={s.session.rotationDue}
      >
        {children}
      </OfficeShell>
    </OfficeLook>
  );
}
