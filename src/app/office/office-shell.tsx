import type { ReactNode } from "react";
import { canAccess, type OfficeArea, type OfficeRole } from "@/lib/auth/roles";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import { btn } from "../ui/classes";
import { Icon, type IconName } from "../ui/icons";
import { OfficeNav, type MenuGroup } from "./office-nav";
import { refreshOfficeSessionAction } from "./session-actions";

// The frame around every office page once someone is logged in (src/app/office/layout.tsx;
// docs/ui-design.md "Office shell"). Display only: every page and action still checks access.
//
// Desktop (1024px and wider): the menu in a 256px sidebar that stays in view, the page beside it
// on the grey canvas (up to 1152px), and the user's name, role and "Log out" at the bottom of the
// sidebar. Phone and tablet: the menu as one sideways-scrolling row under the firm's bar, then
// the page, then the name and "Log out".
//
// The page keeps its own <main>: the shell wraps it in <div id="main"> (the skip link's target),
// and the menu and footer sit outside it. The order in the page is the order you see on a phone:
// menu, page, footer (on a desktop the footer moves to the bottom of the sidebar).

type MenuItem = { area: OfficeArea; href: string; label: string; icon: IconName };

const MENU: { label: string | null; items: MenuItem[] }[] = [
  { label: null, items: [{ area: "today", href: "/office", label: "Today", icon: "home" }] },
  {
    label: "Shifts and people",
    items: [
      { area: "shifts", href: "/office/shifts", label: "Shifts", icon: "shifts" },
      { area: "requests", href: "/office/requests", label: "Requests", icon: "requests" },
      { area: "workers", href: "/office/workers", label: "Workers", icon: "workers" },
    ],
  },
  {
    label: "Records",
    items: [
      { area: "log", href: "/office/log", label: "Action log", icon: "log" },
      { area: "reports", href: "/office/reports/notice", label: "Notice report", icon: "notice" },
      { area: "pilot", href: "/office/reports/pilot", label: "Pilot metrics", icon: "pilot" },
    ],
  },
  {
    label: "Pay",
    items: [
      { area: "pay", href: "/office/pay-queries", label: "Pay queries", icon: "pay" },
      { area: "pay", href: "/office/pay/import", label: "Import pay records", icon: "import" },
    ],
  },
  {
    label: "Admin",
    items: [
      { area: "team", href: "/office/team", label: "Office team", icon: "team" },
      {
        area: "data",
        href: "/office/data",
        label: "Data requests (download or delete)",
        icon: "data",
      },
    ],
  },
  {
    label: "Help",
    items: [{ area: "guide", href: "/office/guide", label: "How-to guide", icon: "guide" }],
  },
];

// The menu a role sees: only the links it can open, and no empty groups. Payroll has no Today;
// their first link is "Home", the same /office page (the dashboard).
export function officeMenu(role: OfficeRole): MenuGroup[] {
  return MENU.map((group) => ({
    label: group.label,
    links: group.items.flatMap((item): MenuGroup["links"] => {
      if (canAccess(role, item.area)) {
        return [{ href: item.href, label: item.label, icon: item.icon }];
      }
      if (item.area === "today" && canAccess(role, "dashboard")) {
        return [{ href: "/office", label: "Home", icon: "home" }];
      }
      return [];
    }),
  })).filter((group) => group.links.length > 0);
}

export function OfficeShell({
  name,
  roleLabel,
  menu,
  rotationDue,
  children,
}: {
  name: string;
  roleLabel: string;
  menu: MenuGroup[];
  rotationDue: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:bg-ink focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-on-ink"
      >
        Skip to content
      </a>
      <div
        data-shell="office"
        className="flex flex-1 flex-col bg-panel text-base text-ink lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-[1fr_auto]"
      >
        <OfficeNav groups={menu} />
        <div
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 bg-canvas focus:outline-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-10 lg:py-8">{children}</div>
        </div>
        {/* On a desktop the footer is pinned to the bottom of the window (one row, 4.5rem tall)
            and the menu above it stops short of it (office-nav.tsx), so on a short laptop screen
            "Log out" is never hidden under the menu. */}
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line bg-panel px-4 py-4 lg:sticky lg:bottom-0 lg:col-start-1 lg:row-start-2 lg:h-[4.5rem] lg:flex-nowrap lg:gap-x-3 lg:py-0">
          <div className="min-w-0">
            <p className="font-semibold break-words text-ink lg:truncate" title={name}>
              {name}
            </p>
            <p className="text-sm text-ink-muted">{roleLabel}</p>
          </div>
          <div className="shrink-0">
            <LogoutButton
              kind="office"
              after="/office/login?out=1"
              className={btn.secondary}
              icon={<Icon name="logout" />}
            />
          </div>
          <SessionKeeper rotationDue={rotationDue} refresh={refreshOfficeSessionAction} />
        </footer>
      </div>
    </>
  );
}
