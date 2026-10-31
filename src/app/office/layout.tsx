import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { canAccess, ROLE_LABELS } from "@/lib/auth/roles";
import { attentionOf } from "@/lib/office/dashboard";
import { THEME_COOKIE, themeFromCookie } from "../theme";
import { officeFrame } from "./frame";
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
  const read = await officeFrame();
  if (!read) return <OfficeLook>{children}</OfficeLook>;
  const { session: s, frame } = read;
  // Every count below, read in one transaction (src/lib/office/frame.ts; Phase 25.3): the Pay
  // queries badge (admins and payroll), the Casuals badge (uploads waiting for a check, 12F.2), the
  // Enquiries badge (messages that need a person, 12D.1), Needs attention's count (its items and the
  // enquiries that need a person, the one count the dashboard's headline uses; 12E.1, Phase 20) and
  // the top bar's sessions (Phase 24). A count that couldn't be read shows no number.
  const value = (p: { ok: true; data: number } | { ok: false } | null) => (p?.ok ? p.data : null);
  const needPerson = value(frame.needPerson);
  const attention = frame.needs ? attentionOf(frame.needs.needs, frame.needPerson) : null;
  // Pale yellow when it needs this person (Phases 18 and 20; office-menu.ts menuBadges).
  const badges = menuBadges(s.officeUser.role, {
    payQueries: value(frame.payQueries) ?? 0,
    needPerson: needPerson ?? 0,
    uploads: value(frame.uploads) ?? 0,
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
          shell: frame.shell?.ok ? frame.shell.data : null,
          // Needs attention's one count, as the menu's (null: it couldn't be read).
          attention: frame.needs
            ? { count: attention?.count ?? null, more: attention?.more ?? false }
            : null,
          payQueries: frame.payQueries ? value(frame.payQueries) : null,
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
