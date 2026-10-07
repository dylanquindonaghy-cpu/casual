"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../ui/icons";

// The office menu (docs/ui-design.md "Office shell"): one set of plain links for every screen
// size. On a desktop it's the sidebar, in groups; on a phone or tablet it's one row of links that
// scrolls sideways, with the current page scrolled into view and an arrow at each edge that has
// more links past it. Built from plain links only (no list items, headings, regions or groups),
// because the browser tests count those on pages. The links come from the server
// (office-shell.tsx), already filtered by role.

export type MenuLink = { href: string; label: string; icon: IconName };
export type MenuGroup = { label: string | null; links: MenuLink[] };

// The menu link for the page at `pathname`: Today (or Home) only for /office itself, the old
// /office/today and the offer pages; otherwise the longest link the path is on or under, so a
// shift marks Shifts, a worker's data page marks Data requests, and pay import isn't Pay queries.
export function currentHref(pathname: string, hrefs: readonly string[]): string | null {
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
// you're on a page inside its section (a shift marks Shifts; the offer page marks Today).
export function ariaCurrent(href: string, pathname: string): "page" | "true" {
  const exact = href === pathname || (href === "/office" && pathname === "/office/today");
  return exact ? "page" : "true";
}

// The shell is drawn by the office layout, which Next keeps (doesn't redraw) as you move between
// office pages. If the session ends on the server (access turned off, "Log out on every device",
// or it ran out), the next click sends you to /office/login and the old menu, name and "Log out"
// would stay around the login card. Arriving at a login page from another page asks the server to
// redraw it once: with no session the shell goes (and this menu with it); with one, the login
// page sends you on to /office. Never on the page the shell was drawn on, so it can't repeat.
const LOGIN_PAGES: readonly string[] = ["/office/login", "/office/l"];
export function redrawOnArrival(previous: string, pathname: string): boolean {
  return previous !== pathname && LOGIN_PAGES.includes(pathname);
}

// Which ends of the phone row have links hidden past them (1px slack for rounding).
export function hiddenEdges(row: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): { left: boolean; right: boolean } {
  return {
    left: row.scrollLeft > 1,
    right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
  };
}

// Phone: a pill with a border; the current one filled dark. Desktop: a full-width row with an
// icon; the current one shaded, bold, with a dark bar at the sidebar's edge.
const LINK =
  "flex min-h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-full border px-4 text-base lg:rounded-lg lg:border-transparent lg:px-3 lg:py-2 lg:whitespace-normal";
const IDLE = `${LINK} border-line-strong bg-panel font-semibold text-ink hover:bg-quiet-soft lg:bg-transparent lg:font-medium`;
const ACTIVE = `${LINK} relative border-ink bg-ink font-semibold text-on-ink lg:bg-quiet-soft lg:text-ink lg:before:absolute lg:before:inset-y-1.5 lg:before:-left-3 lg:before:w-1 lg:before:rounded-r-full lg:before:bg-ink`;
// The "more links this way" arrow: a white band over the row's end, with a line on its inner
// side. Hidden from screen readers (every link is still in the menu) and lets taps and swipes
// through to the row. Phone and tablet only; it shows only while links are hidden that way.
const EDGE =
  "pointer-events-none absolute inset-y-0 flex items-center bg-panel px-2 text-ink-muted lg:hidden";
// Room kept beside a link reached with the keyboard: more than the arrow's band (37px) plus the
// focus ring (4px), so the link is never under the arrow.
const KEEP_CLEAR = 48;

export function OfficeNav({ groups }: { groups: MenuGroup[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = currentHref(
    pathname,
    groups.flatMap((g) => g.links.map((l) => l.href)),
  );
  const strip = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLAnchorElement>(null);
  const shownAt = useRef(pathname);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Read which ends have hidden links. Only sets state when that changes, so scrolling doesn't
  // re-render the menu on every frame.
  const measure = useCallback(() => {
    const row = strip.current;
    if (!row) return;
    const next = hiddenEdges(row);
    setEdges((was) => (was.left === next.left && was.right === next.right ? was : next));
  }, []);

  // Phone and tablet: bring the current page's link into view, sideways only (never moves the
  // page up or down). On a desktop the row doesn't scroll, so this does nothing. Then measure.
  useEffect(() => {
    const row = strip.current;
    const link = active.current;
    if (row && link && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
    }
    measure();
  }, [current, measure]);

  // Measure again whenever the row changes size (a turned phone, a resized window, bigger text).
  useEffect(() => {
    const row = strip.current;
    if (!row) return;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(row);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const previous = shownAt.current;
    shownAt.current = pathname;
    if (redrawOnArrival(previous, pathname)) router.refresh();
  }, [pathname, router]);

  // A link reached with the keyboard is shown whole, clear of the edge arrows, with room for its
  // focus ring (the browser leaves a half-hidden link where it is).
  const reveal = (link: EventTarget) => {
    const row = strip.current;
    if (!row || !(link instanceof HTMLElement) || row.scrollWidth <= row.clientWidth) return;
    const left = link.offsetLeft - KEEP_CLEAR;
    const right = link.offsetLeft + link.offsetWidth + KEEP_CLEAR;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  };

  return (
    <nav
      aria-label="Office menu"
      // Desktop: pinned to the top, and never taller than the window less the firm's bar (3.5rem)
      // and the shell's pinned footer (4.5rem), so it never covers "Log out"; it scrolls inside.
      className="relative border-b border-line bg-panel lg:sticky lg:top-0 lg:col-start-1 lg:row-start-1 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:border-b-0"
    >
      <div
        ref={strip}
        onFocus={(e) => reveal(e.target)}
        onScroll={measure}
        className="relative flex gap-2 overflow-x-auto px-4 py-3 lg:block lg:overflow-visible lg:px-3 lg:py-6"
      >
        {groups.map((group, i) => (
          <div
            key={group.label ?? i}
            className="flex shrink-0 gap-2 lg:mt-6 lg:block lg:first:mt-0"
          >
            {group.label ? (
              <p className="hidden px-3 pb-1.5 text-sm font-semibold text-ink-muted lg:block">
                {group.label}
              </p>
            ) : null}
            {group.links.map((link) => {
              const on = link.href === current;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  ref={on ? active : undefined}
                  aria-current={on ? ariaCurrent(link.href, pathname) : undefined}
                  className={on ? ACTIVE : IDLE}
                >
                  <Icon
                    name={link.icon}
                    className={on ? "hidden lg:block" : "hidden text-ink-muted lg:block"}
                  />
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {edges.left ? (
        <span aria-hidden="true" className={`${EDGE} left-0 border-r border-line`}>
          <Icon name="chevron" className="rotate-180" />
        </span>
      ) : null}
      {edges.right ? (
        <span aria-hidden="true" className={`${EDGE} right-0 border-l border-line`}>
          <Icon name="chevron" />
        </span>
      ) : null}
    </nav>
  );
}
