"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { Icon, type IconName } from "../ui/icons";

// The office menu's links (docs/office-v2.md 3.1; docs/ui-design.md "Office shell"), in groups:
// the sidebar from 1024px, and the same <nav> inside the drawer below that (office-frame.tsx moves
// it there while the drawer is open, so a page never has two). Plain links only (no list items,
// headings, regions, groups or `menu` roles), because the browser tests count those on pages: so
// the folded group is a button that shows or hides its links, not a <details> (a "group").
// The links come from the server (office-shell.tsx), already filtered by role.

// A count beside a link ("Pay queries 3"), drawn outside the link's name: the link stays exactly
// "Pay queries" (the tests find links by their exact names), and screen readers hear the words
// after it.
// `needs`: it needs this person (sign yellow); otherwise grey (Phase 18).
export type MenuBadge = { count: number; words: string; needs?: boolean };
export type MenuLink = { href: string; label: string; icon: IconName; badge?: MenuBadge };
// `folded`: a button that shows its links, shown already when you're on one of its pages ("Admin
// and records"); `bottom`: at the foot of the menu, with no label (the how-to guide).
export type MenuGroup = { label: string; links: MenuLink[]; folded?: boolean; bottom?: boolean };

// The menu link for the page at `pathname`: the dashboard (or payroll's Home) only for /office itself, the old
// /office/today, Needs attention and the offer pages; the shift pages for Events & sessions (its link moved to
// /office/events in 12B.5; the shift routes stayed); otherwise the longest link the path is on or
// under, so a worker's data page marks Data requests, and pay import isn't Pay queries.
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
  if (pathname === "/office/shifts" || pathname.startsWith("/office/shifts/")) {
    return hrefs.includes("/office/events") ? "/office/events" : null;
  }
  if (
    pathname === "/office" ||
    pathname === "/office/today" ||
    pathname === "/office/needs-attention" ||
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

// A full-width row with an icon. The current one: bold on the card colour with a hairline, like a
// card lifted off the menu's ground (Phase 18), its icon filled in.
const LINK =
  "relative flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base text-ink-muted hover:bg-quiet-soft hover:text-ink";
const IDLE = `${LINK} font-medium`;
const ACTIVE = `${LINK} bg-card font-semibold text-ink ring-1 ring-line`;
const LABEL = "px-2.5 pt-3.5 pb-1 text-sm font-semibold text-ink-muted first:pt-1";

function NavLink({
  link,
  current,
  pathname,
}: {
  link: MenuLink;
  current: string | null;
  pathname: string;
}) {
  const on = link.href === current;
  return (
    <div>
      <Link
        href={link.href}
        aria-current={on ? ariaCurrent(link.href, pathname) : undefined}
        className={on ? ACTIVE : IDLE}
      >
        <Icon name={link.icon} size={18} className={on ? "fill-current/15" : ""} />
        <span className="min-w-0 flex-1">{link.label}</span>
        {link.badge ? (
          <span
            aria-hidden="true"
            className={`inline-flex h-5 min-w-6 items-center justify-center rounded px-1.5 text-sm font-semibold tabular-nums ${
              link.badge.needs ? "bg-hivis text-on-hivis" : "bg-raised text-ink-muted"
            }`}
          >
            {link.badge.count}
          </span>
        ) : null}
      </Link>
      {link.badge ? <span className="sr-only">{link.badge.words}</span> : null}
    </div>
  );
}

// A folded group: its button (waits for the page) and its links, shown while you're on one of its
// pages unless you close it, or once you open it.
function Fold({
  group,
  current,
  pathname,
}: {
  group: MenuGroup;
  current: string | null;
  pathname: string;
}) {
  const ready = useHydrated();
  const inside = group.links.some((l) => l.href === current);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const shown = chosen ?? inside;
  const id = `menu-${group.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        disabled={!ready}
        onClick={() => setChosen(!shown)}
        className={`${IDLE} w-full text-left disabled:cursor-default`}
      >
        <Icon name="settings" size={18} />
        <span className="min-w-0 flex-1">{group.label}</span>
        <Icon
          name="chevron"
          size={16}
          className={`transition-transform duration-200 ease-sd ${shown ? "-rotate-90" : "rotate-90"}`}
        />
      </button>
      <div id={id} hidden={!shown} className="flex animate-in flex-col gap-px pl-5">
        {group.links.map((link) => (
          <NavLink key={link.href} link={link} current={current} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

export function OfficeNav({ groups, firmName }: { groups: MenuGroup[]; firmName?: string }) {
  const pathname = usePathname();
  const current = currentHref(
    pathname,
    groups.flatMap((g) => g.links.map((l) => l.href)),
  );
  const initial = firmName?.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
  return (
    <nav aria-label="Office menu" className="flex min-h-full flex-col gap-px px-2.5 py-3.5">
      {firmName && (
        <p className="flex items-center gap-2.5 px-2 pb-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-bar text-lg font-extrabold text-on-brand-bar"
          >
            {initial}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold text-ink">{firmName}</span>
            <span className="block text-sm text-ink-muted">Office</span>
          </span>
        </p>
      )}
      {groups.map((group) =>
        group.folded ? (
          // Keyed by whether you're on one of its pages, so arriving at one shows it again.
          <Fold
            key={`${group.label}:${group.links.some((l) => l.href === current)}`}
            group={group}
            current={current}
            pathname={pathname}
          />
        ) : (
          <div key={group.label} className={group.bottom ? "mt-auto pt-4" : ""}>
            {!group.bottom && <p className={LABEL}>{group.label}</p>}
            <div className="flex flex-col gap-px">
              {group.links.map((link) => (
                <NavLink key={link.href} link={link} current={current} pathname={pathname} />
              ))}
            </div>
          </div>
        ),
      )}
    </nav>
  );
}
