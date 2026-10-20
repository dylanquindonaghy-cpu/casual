"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "../ui/icons";

// The office menu's links (docs/office-v2.md 3.1; docs/ui-design.md "Office shell"), in groups:
// the sidebar from 1024px, and the same <nav> inside the drawer below that (office-frame.tsx moves
// it there while the drawer is open, so a page never has two). Plain links only (no list items,
// headings, regions, groups or `menu` roles), because the browser tests count those on pages.
// The links come from the server (office-shell.tsx), already filtered by role.

// A count beside a link ("Pay queries 3"), drawn outside the link's name: the link stays exactly
// "Pay queries" (the tests find links by their exact names), and screen readers hear the words
// after it.
export type MenuBadge = { count: number; words: string };
export type MenuLink = { href: string; label: string; icon: IconName; badge?: MenuBadge };
export type MenuGroup = { label: string; links: MenuLink[] };

// The menu link for the page at `pathname`: the dashboard (or payroll's Home) only for /office itself, the old
// /office/today and the offer pages; the shift pages for Events & sessions (its link moved to
// /office/events in 12B.5; the shift routes stayed); otherwise the longest link the path is on or
// under, so a worker's data page marks Data requests, and pay import isn't Pay queries.
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  if (pathname === "/office/shifts" || pathname.startsWith("/office/shifts/")) {
    return hrefs.includes("/office/events") ? "/office/events" : null;
  }
  if (
    pathname === "/office" ||
    pathname === "/office/today" ||
    pathname.startsWith("/office/offer/")
  ) {
    return hrefs.includes("/office") ? "/office" : null;
  }
  let best: string | null = null;
  for (const href of hrefs) {
    if (href === "/office") continue;
    const on = pathname === href || pathname.startsWith(`${href}/`);
    if (on && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

// What a marked link tells a screen reader: "page" when it is the page you're on, "true" when
// you're on a page inside its section (a shift marks Events & sessions; the offer page marks the dashboard).
export function ariaCurrent(href: string, pathname: string): "page" | "true" {
  const exact = href === pathname || (href === "/office" && pathname === "/office/today");
  return exact ? "page" : "true";
}

// A full-width row with an icon. The current one: bold on a pale tint of the firm's colour, its icon
// filled in (Phase 17: no bar at the menu's edge as well).
const LINK =
  "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-base text-ink hover:bg-quiet-soft";
const IDLE = `${LINK} font-medium`;
const ACTIVE = `${LINK} bg-brand-soft font-semibold`;

export function OfficeNav({ groups }: { groups: MenuGroup[] }) {
  const pathname = usePathname();
  const current = currentHref(
    pathname,
    groups.flatMap((g) => g.links.map((l) => l.href)),
  );
  return (
    <nav aria-label="Office menu" className="px-3 py-6">
      {groups.map((group) => (
        <div key={group.label} className="mt-6 first:mt-0">
          <p className="px-3 pb-1.5 text-sm font-semibold text-ink-muted">{group.label}</p>
          {group.links.map((link) => {
            const on = link.href === current;
            return (
              <div key={link.href}>
                <Link
                  href={link.href}
                  aria-current={on ? ariaCurrent(link.href, pathname) : undefined}
                  className={on ? ACTIVE : IDLE}
                >
                  <Icon name={link.icon} className={on ? "fill-current/15" : "text-ink-muted"} />
                  {link.label}
                  {link.badge ? (
                    <span
                      aria-hidden="true"
                      className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full border border-transparent bg-urgent-fill px-1.5 text-xs font-semibold text-on-urgent"
                    >
                      {link.badge.count}
                    </span>
                  ) : null}
                </Link>
                {link.badge ? <span className="sr-only">{link.badge.words}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
