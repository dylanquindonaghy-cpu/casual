import type { MenuBadge, MenuGroup, MenuLink } from "./office-nav";

// The rail's rows (Phase 24; office-rail.tsx), worked out from the menu a role sees. Plain data and
// functions, safe on the server too (the how-to guide describes the rail from them).

export type RailItem =
  { kind: "link"; link: MenuLink } | { kind: "fold"; group: MenuGroup; id: string; apart: boolean };

// The rail's rows, from the menu a role sees: each group's links as icons, but a group marked
// `rail: "fold"` as one fold (the folded group, Admin and records, under a line). The how-to guide
// stays in the account menu. A role whose menu is only folds (payroll's Pay) gets their links as
// icons.
export function railItems(groups: readonly MenuGroup[]): RailItem[] {
  const shown = groups.filter((g) => !g.bottom);
  const links = shown.some((g) => g.rail !== "fold");
  return shown.flatMap((g): RailItem[] =>
    g.rail === "fold" && links
      ? [
          {
            kind: "fold",
            group: g,
            id: `rail-${g.label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
            apart: g.folded === true,
          },
        ]
      : g.links.map((link) => ({ kind: "link", link })),
  );
}

// A fold's count (its pages' counts added up: Pay's pay queries, People's uploads to check), and
// whether it needs you; its words, as each page's.
export function foldBadge(group: MenuGroup): MenuBadge | null {
  const badges = group.links.flatMap((l) => (l.badge ? [l.badge] : []));
  if (badges.length === 0) return null;
  return {
    count: badges.reduce((n, b) => n + b.count, 0),
    more: badges.some((b) => b.more),
    words: badges.map((b) => b.words).join(", "),
    needs: badges.some((b) => b.needs),
  };
}

// What shows beside a shut icon: its name, and its count's words ("Enquiries, 2 need a person").
export const tipWords = (label: string, badge: MenuBadge | null | undefined) =>
  badge ? `${label}, ${badge.words}` : label;
