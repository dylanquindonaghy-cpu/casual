import type { ReactNode } from "react";
import type { UpdatesBell } from "@/lib/office/updates";
import type { Theme } from "../theme";
import { OfficeFrame } from "./office-frame";
import type { BarCount } from "./office-menu";
import type { MenuGroup } from "./office-nav";
import { searchOfficeAction } from "./search-actions";
import { refreshOfficeSessionAction } from "./session-actions";
import { markOfficeTourSeenAction } from "./tour-actions";

export { barCounts, MENU_AREAS, menuBadges, officeMenu } from "./office-menu";

// The frame around every office page once someone is logged in (src/app/office/layout.tsx;
// docs/office-v2.md 3.1; docs/ui-design.md "Office shell"), with the menu and the top bar's counts
// from office-menu.ts, and the search for a role that can open what it finds. Display only: every
// page and action still checks access.

// Hook-free, so the tests can call it directly.
export function OfficeShell({
  name,
  roleLabel,
  firmName,
  menu,
  counts,
  canSearch,
  railOpen,
  theme,
  rotationDue,
  updates = null,
  tour = null,
  children,
}: {
  name: string;
  roleLabel: string;
  firmName: string;
  menu: MenuGroup[];
  counts: BarCount[];
  canSearch: boolean;
  railOpen: boolean;
  theme: Theme | undefined;
  rotationDue: boolean;
  updates?: UpdatesBell | null; // the bell and the pop-up (admins and resourcers; Phase 26.4)
  // The first-login tour (Phase 33.2; admins and resourcers): seen yet, and this login's own key.
  tour?: { seen: boolean; laterKey: string } | null;
  children: ReactNode;
}) {
  return (
    <OfficeFrame
      name={name}
      roleLabel={roleLabel}
      firmName={firmName}
      menu={menu}
      counts={counts}
      search={canSearch ? searchOfficeAction : null}
      railOpen={railOpen}
      theme={theme}
      rotationDue={rotationDue}
      updates={updates}
      refresh={refreshOfficeSessionAction}
      tour={tour ? { ...tour, markSeen: markOfficeTourSeenAction } : null}
    >
      {children}
    </OfficeFrame>
  );
}
