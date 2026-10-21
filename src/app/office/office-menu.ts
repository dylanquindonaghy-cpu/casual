import { canAccess, type OfficeArea, type OfficeRole } from "@/lib/auth/roles";
import type { IconName } from "../ui/icons";
import type { MenuBadge, MenuGroup } from "./office-nav";

// The office menu (docs/office-v2.md 3.1): the v2 groups and the links each role sees. Plain
// data and one function, safe anywhere (the shell, the guide, the roles test).

type MenuItem = { area: OfficeArea; href: string; label: string; icon: IconName };

// The groups (docs/office-v2.md 3.1; Phase 18's regrouping): what needs the office today first, then
// pay, then people; the records and settings folded under "Admin and records"; the how-to guide on
// its own at the bottom.
const MENU: { label: string; folded?: boolean; bottom?: boolean; items: MenuItem[] }[] = [
  {
    label: "Today",
    items: [
      // The dashboard (12E.1): the bell in the top bar links to its Needs attention page.
      { area: "today", href: "/office", label: "Dashboard", icon: "home" },
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
    label: "People",
    items: [
      { area: "casuals", href: "/office/casuals", label: "Casuals", icon: "workers" },
      // No badge: strikes aren't a to-do (docs/office-v2.md 3.5).
      { area: "strikes", href: "/office/strikes", label: "Strikes", icon: "strike" },
      { area: "reports", href: "/office/reports/notice", label: "Notice report", icon: "notice" },
    ],
  },
  {
    label: "Admin and records",
    folded: true,
    items: [
      { area: "log", href: "/office/log", label: "Action log", icon: "log" },
      { area: "pilot", href: "/office/reports/pilot", label: "Pilot metrics", icon: "pilot" },
      { area: "team", href: "/office/team", label: "Office team", icon: "team" },
      { area: "settings", href: "/office/settings", label: "Settings", icon: "settings" },
      // The planner's API keys (12J.1; docs/office-v2.md 5.3.4).
      {
        area: "integrations",
        href: "/office/settings/integrations",
        label: "Integrations",
        icon: "plug",
      },
      { area: "data", href: "/office/data", label: "Data requests", icon: "data" },
    ],
  },
  {
    label: "Help",
    bottom: true,
    items: [{ area: "guide", href: "/office/guide", label: "How-to guide", icon: "guide" }],
  },
];

// Every area the menu links to (tests/unit/office.roles.test.ts checks each against the roles).
export const MENU_AREAS: readonly OfficeArea[] = MENU.flatMap((g) => g.items.map((i) => i.area));

// The menu a role sees: only the links it can open, and no empty groups. `badges` gives a link a
// count by its address (the layout's: Pay queries waiting), sign yellow when it needs this person
// (`needs`), grey otherwise.
export function officeMenu(
  role: OfficeRole,
  badges: Partial<Record<string, MenuBadge>> = {},
): MenuGroup[] {
  return MENU.map((group) => ({
    label: group.label,
    ...(group.folded ? { folded: true } : {}),
    ...(group.bottom ? { bottom: true } : {}),
    links: group.items
      .filter((item) => canAccess(role, item.area))
      .map((item) => {
        const badge = badges[item.href];
        return { href: item.href, label: item.label, icon: item.icon, ...(badge ? { badge } : {}) };
      }),
  })).filter((group) => group.links.length > 0);
}
