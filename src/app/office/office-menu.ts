import { canAccess, type OfficeArea, type OfficeRole } from "@/lib/auth/roles";
import type { IconName } from "../ui/icons";
import type { MenuBadge, MenuGroup } from "./office-nav";

// The office menu (docs/office-v2.md 3.1): the v2 groups and the links each role sees. Plain
// data and one function, safe anywhere (the shell, the guide, the roles test).

type MenuItem = { area: OfficeArea; href: string; label: string; icon: IconName };

// The groups (docs/office-v2.md 3.1; Phases 18 and 20): the dashboard and Needs attention at the
// top with no label (Needs attention in place of the bell: Phase 20), then what needs the office
// today, then pay, then people; the records and settings folded under "Admin and records"; the
// how-to guide on its own at the bottom. Phase 24 (round 7): the same links in the rail
// (office-rail.tsx), in the same order, Pay, People and Admin and records each a fold there with its
// own icon (`rail`, `icon`); Enquiries before Cancellations, as the rail lists them.
const MENU: {
  label: string;
  folded?: boolean;
  bottom?: boolean;
  top?: boolean;
  rail?: "fold";
  icon?: IconName;
  items: MenuItem[];
}[] = [
  {
    label: "Home",
    top: true,
    items: [
      { area: "today", href: "/office", label: "Dashboard", icon: "home" },
      // Its count: the one count of what needs a person (menuBadges).
      {
        area: "today",
        href: "/office/needs-attention",
        label: "Needs attention",
        icon: "bell",
      },
    ],
  },
  {
    label: "Today",
    items: [
      // The shift pages (/office/shifts/...) stay, inside this section (office-nav.tsx).
      { area: "shifts", href: "/office/events", label: "Events & sessions", icon: "shifts" },
      // The Need a person badge (12D.1); /office/requests redirects to its "Requests from the app".
      { area: "enquiries", href: "/office/enquiries", label: "Enquiries", icon: "requests" },
      {
        area: "cancellations",
        href: "/office/cancellations",
        label: "Cancellations",
        icon: "cancel",
      },
    ],
  },
  {
    label: "Pay",
    rail: "fold",
    icon: "pay",
    items: [
      // Payroll's home (/office sends them here).
      { area: "pay", href: "/office/pay", label: "Pay dashboard", icon: "dashboard" },
      { area: "pay", href: "/office/pay-queries", label: "Pay queries", icon: "pay" },
      { area: "pay", href: "/office/pay/import", label: "Import pay records", icon: "import" },
    ],
  },
  {
    label: "People",
    rail: "fold",
    icon: "workers",
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
    rail: "fold",
    icon: "settings",
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

// The menu's counts (Phases 18 and 20; since Phase 21 one grey pill, office-nav.tsx): `needs` when
// it needs this person.
// Pay queries waiting need payroll (for the others they're with payroll); enquiries that need a
// person, uploads to check and Needs attention's items (with those enquiries: `attention`, the
// one count) need whoever sees them. No count, no badge.
export function menuBadges(
  role: OfficeRole,
  counts: {
    payQueries: number;
    needPerson: number;
    uploads: number;
    attention?: { count: number; more: boolean } | null;
  },
): Partial<Record<string, MenuBadge>> {
  const { payQueries, needPerson, uploads, attention } = counts;
  return {
    ...(attention && attention.count > 0
      ? {
          "/office/needs-attention": {
            count: attention.count,
            more: attention.more,
            words: `${attention.count}${attention.more ? "+" : ""} to deal with`,
            needs: true,
          },
        }
      : {}),
    ...(payQueries
      ? {
          "/office/pay-queries": {
            count: payQueries,
            words: `${payQueries} waiting`,
            needs: role === "payroll",
          },
        }
      : {}),
    ...(needPerson
      ? {
          "/office/enquiries": {
            count: needPerson,
            words: `${needPerson} need a person`,
            needs: true,
          },
        }
      : {}),
    ...(uploads
      ? { "/office/casuals": { count: uploads, words: `${uploads} to check`, needs: true } }
      : {}),
  };
}

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
    ...(group.top ? { top: true } : {}),
    ...(group.rail ? { rail: group.rail } : {}),
    ...(group.icon ? { icon: group.icon } : {}),
    links: group.items
      .filter((item) => canAccess(role, item.area))
      .map((item) => {
        const badge = badges[item.href];
        return { href: item.href, label: item.label, icon: item.icon, ...(badge ? { badge } : {}) };
      }),
  })).filter((group) => group.links.length > 0);
}

// The top bar's counts (Phase 24, round 7: the first of its three capsules), each opening where it's
// worked and only for the roles that can open that page: places to fill and urgent places (Events &
// sessions' "Need people" and "Urgent" views), offers out with no reply yet (the dashboard's offers
// chart), what Needs attention holds (its one count, as the menu's: "To check") and the pay queries
// waiting. `count` null: it couldn't be read (the words show with no number).
export type BarCount = {
  key: "toFill" | "urgent" | "offersOut" | "toCheck" | "payQueries";
  label: string;
  href: string;
  icon: IconName;
  count: number | null;
  more?: boolean;
  urgent?: boolean; // red while there are any
};

export function barCounts(
  role: OfficeRole,
  counts: {
    shell: { toFill: number; urgent: number; offersOut: number } | null;
    attention: { count: number | null; more: boolean } | null;
    payQueries: number | null;
  },
): BarCount[] {
  const { shell, attention, payQueries } = counts;
  const out: BarCount[] = [];
  if (canAccess(role, "shifts")) {
    out.push(
      {
        key: "toFill",
        label: "To fill",
        href: "/office/events?view=need",
        icon: "profile",
        count: shell?.toFill ?? null,
      },
      {
        key: "urgent",
        label: "Urgent",
        href: "/office/events?view=urgent",
        icon: "clock",
        count: shell?.urgent ?? null,
        urgent: (shell?.urgent ?? 0) > 0,
      },
      {
        key: "offersOut",
        label: "Offers out",
        href: "/office#offers-chart",
        icon: "send",
        count: shell?.offersOut ?? null,
      },
    );
  }
  if (canAccess(role, "today")) {
    out.push({
      key: "toCheck",
      label: "To check",
      href: "/office/needs-attention",
      icon: "checkbox",
      count: attention?.count ?? null,
      more: attention?.more ?? false,
    });
  }
  if (canAccess(role, "pay")) {
    out.push({
      key: "payQueries",
      label: "Pay queries",
      href: "/office/pay-queries",
      icon: "pay",
      count: payQueries,
    });
  }
  return out;
}
