import type { ReactNode } from "react";
import { getOfficeSession } from "@/lib/auth/current-office";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { OfficeShell, officeMenu } from "./office-shell";

// Every office page sits in the office shell (the menu, the user's name and "Log out") once
// someone is logged in. With no session (/office/login, /office/l, or a page that's about to send
// you to log in) the page shows on its own. Display only, so it never redirects or hides a page:
// each page checks its own access (requireOfficeArea), and each action its own.
export default async function OfficeLayout({ children }: { children: ReactNode }) {
  const s = await getOfficeSession();
  if (!s) return <>{children}</>;
  return (
    <OfficeShell
      name={s.officeUser.name}
      roleLabel={ROLE_LABELS[s.officeUser.role]}
      menu={officeMenu(s.officeUser.role)}
      rotationDue={s.session.rotationDue}
    >
      {children}
    </OfficeShell>
  );
}
