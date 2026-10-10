import { canAccess, type OfficeArea, type OfficeRole } from "@/lib/auth/roles";
import type { IconName } from "../ui/icons";
import type { MenuBadge, MenuGroup } from "./office-nav";

// The office menu (docs/office-v2.md 3.1): the v2 groups and the links each role sees. Plain
// data and one function, safe anywhere (the shell, the guide, the roles test).

type MenuItem = { area: OfficeArea; href: string; label: string; icon: IconName };

// The v2 groups (3.1), holding today's pages; each later task adds its own link.
const MENU: { label: string; items: MenuItem[] }[] = [
  {
    label: "Operations",
    items: [
      { area: "today", href: "/office", label: "Today", icon: "home" },
      // The shift pages (/office/shifts/...) stay, inside this section (office-nav.tsx).
      { area: "shifts", href: "/office/events", label: "Events & sessions", icon: "shifts" },
      {
        area: "cancellations",
        href: "/office/cancellations",
        label: "Cancellations",
        icon: "cancel",
      },
      // The Need a person badge (12D.1); /office/requests redirects to its "Requests from the app".
      { area: "enquiries", href: "/office/enquiries", label: "Enquiries", icon: "requests" },
    ],
  },
  {
    label: "Pay",
    items: [
      // Payroll's home (/office sends them here).
      { area: "pay", href: "/office/pay", label: "Pay dashboard", icon: "dashboard" },
      { area: "pay", href: "/office/pay-queries", label: "Pay queries", icon: "pay" },
      { area: "pay", href: "/office/pay/import", label: "Import pay records", icon: "import" },
    ],
  },
  {
    label: "Records",
    items: [
      // No badge: strikes aren't a to-do (docs/office-v2.md 3.5).
      { area: "strikes", href: "/office/strikes", label: "Strikes", icon: "strike" },
      { area: "casuals", href: "/office/casuals", label: "Casuals", icon: "workers" },
      { area: "log", href: "/office/log", label: "Action log", icon: "log" },
      { area: "reports", href: "/office/reports/notice", label: "Notice report", icon: "notice" },
      { area: "pilot", href: "/office/reports/pilot", label: "Pilot metrics", icon: "pilot" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { area: "team", href: "/office/team", label: "Office team", icon: "team" },
      { area: "settings", href: "/office/settings", label: "Settings", icon: "settings" },
      { area: "data", href: "/office/data", label: "Data requests", icon: "data" },
    ],
  },
  {
    label: "Help",
    items: [{ area: "guide", href: "/office/guide", label: "How-to guide", icon: "guide" }],
  },
];

// Every area the menu links to (tests/unit/office.roles.test.ts checks each against the roles).
export const MENU_AREAS: readonly OfficeArea[] = MENU.flatMap((g) => g.items.map((i) => i.area));

// The menu a role sees: only the links it can open, and no empty groups. `badges` gives a link a
// count by its address (the layout's: Pay queries waiting).
export function officeMenu(
  role: OfficeRole,
  badges: Partial<Record<string, MenuBadge>> = {},
): MenuGroup[] {
  return MENU.map((group) => ({
    label: group.label,
    links: group.items
      .filter((item) => canAccess(role, item.area))
      .map((item) => {
        const badge = badges[item.href];
        return { href: item.href, label: item.label, icon: item.icon, ...(badge ? { badge } : {}) };
      }),
  })).filter((group) => group.links.length > 0);
}
