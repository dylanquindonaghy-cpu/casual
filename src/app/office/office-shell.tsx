import type { ReactNode } from "react";
import type { Theme } from "../theme";
import { OfficeFrame } from "./office-frame";
import type { MenuGroup } from "./office-nav";
import { refreshOfficeSessionAction } from "./session-actions";

export { MENU_AREAS, menuBadges, officeMenu } from "./office-menu";

// The frame around every office page once someone is logged in (src/app/office/layout.tsx;
// docs/office-v2.md 3.1; docs/ui-design.md "Office shell"), with the menu from office-menu.ts.
// Display only: every page and action still checks access.

// Hook-free, so the tests can call it directly.
export function OfficeShell({
  name,
  roleLabel,
  firmName,
  payWeek,
  menu,
  theme,
  rotationDue,
  children,
}: {
  name: string;
  roleLabel: string;
  firmName: string;
  payWeek: string;
  menu: MenuGroup[];
  theme: Theme | undefined;
  rotationDue: boolean;
  children: ReactNode;
}) {
  return (
    <OfficeFrame
      name={name}
      roleLabel={roleLabel}
      firmName={firmName}
      payWeek={payWeek}
      menu={menu}
      theme={theme}
      rotationDue={rotationDue}
      refresh={refreshOfficeSessionAction}
    >
      {children}
    </OfficeFrame>
  );
}
