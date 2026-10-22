"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { countNeeds, countWaiting } from "../ui/classes";
import { Icon, type IconName } from "../ui/icons";
import { MenuPending, MenuPendingReporter } from "./menu-pending";

// The office menu's links (docs/office-v2.md 3.1; docs/ui-design.md "Office shell"), in groups:
// the sidebar from 1024px, and the same <nav> inside the drawer below that (office-frame.tsx moves
// it there while the drawer is open, so a page never has two). Plain links only (no list items,
// headings, regions, groups or `menu` roles), because the browser tests count those on pages: so
// the folded group is a button that shows or hides its links, not a <details> (a "group").
// The links come from the server (office-shell.tsx), already filtered by role. Phase 22 (round 2,
// Dylan's approved mock-up): the page you're on is a white pill raised off the menu's ground,
// which slides to the link you pick as you pick it (on a spring, `slide` in globals.css); rows are
// 44px for a thumb and 34px with a mouse from 1024px, so the whole menu fits a laptop window; the
// firm's name and your account sit above the menu (office-frame.tsx), and the how-to guide is in
// the account menu.

// A count beside a link ("Pay queries 3"), drawn outside the link's name: the link stays exactly
// "Pay queries" (the tests find links by their exact names), and screen readers hear the words
// after it. Phase 22: in its dashboard card's colour, amber when it needs this person (`needs`,
// `countNeeds`: Needs attention's), blue when it's waiting with someone else (`countWaiting`: pay
// queries with payroll); one grey pill in Phase 21. `more`: a list stopped at 50 ("50+").
export type MenuBadge = { count: number; words: string; needs?: boolean; more?: boolean };
export type MenuLink = { href: string; label: string; icon: IconName; badge?: MenuBadge };
// `folded`: a button that shows its links, shown already when you're on one of its pages ("Admin
// and records"); `bottom`: the how-to guide, which the menu leaves to the account menu (Phase 22;
// at the foot of the menu until then); `top`: at the top, with no label (the dashboard and Needs
// attention: Phase 20).
export type MenuGroup = {
  label: string;
  links: MenuLink[];
  folded?: boolean;
  bottom?: boolean;
  top?: boolean;
};

// The menu link for the page at `pathname`: the dashboard (or payroll's Home) only for /office
// itself, the old /office/today and the offer pages; the shift pages for Events & sessions (its
// link moved to /office/events in 12B.5; the shift routes stayed); otherwise the longest link the
// path is on or under, so Needs attention marks its own link (Phase 20), a worker's data page marks
// Data requests, and pay import isn't Pay queries.
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

// A full-width row with an icon: 44px tall for a thumb (the drawer, a touch screen), 34px with a
// mouse from 1024px (Phase 22). The page you're on has dark words; its white pill is drawn once,
// under the rows, and slides between them (`Pill`); until the page is ready the row draws its own.
const LINK =
  "press relative z-10 flex min-h-11 items-center gap-3 rounded-row px-3 py-2 text-base lg:pointer-fine:min-h-8.5 lg:pointer-fine:py-1";
const IDLE = `${LINK} text-ink-muted hover:bg-active/70 hover:text-ink active:bg-active`;
const ON = `${LINK} font-medium text-ink`;
const ON_ALONE = `${ON} bg-pill shadow-soft`;
// A group's name: small, grey, sentence case.
const LABEL = "px-3 pt-2 pb-1 text-xs font-medium text-ink-muted";

function NavLink({
  link,
  current,
  shown,
  pathname,
}: {
  link: MenuLink;
  current: string | null;
  shown: string | null;
  pathname: string;
}) {
  const hydrated = useHydrated();
  const on = link.href === current;
  const lit = link.href === shown;
  // Picked: its page is on its way (its skeleton, and the drawer shuts: menu-pending.tsx).
  const { start } = useContext(MenuPending);
  return (
    <div>
      <Link
        href={link.href}
        aria-current={on ? ariaCurrent(link.href, pathname) : undefined}
        className={lit ? (hydrated ? ON : ON_ALONE) : IDLE}
        onNavigate={() => start(link.href)}
      >
        <Icon name={link.icon} size={18} className={lit ? "text-ink" : "text-ink-muted"} />
        <span className="min-w-0 flex-1">{link.label}</span>
        <MenuPendingReporter href={link.href} />
        {link.badge ? (
          <span aria-hidden="true" className={link.badge.needs ? countNeeds : countWaiting}>
            {link.badge.count}
            {link.badge.more ? "+" : ""}
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
  shown,
  pathname,
}: {
  group: MenuGroup;
  current: string | null;
  shown: string | null;
  pathname: string;
}) {
  const ready = useHydrated();
  const inside = group.links.some((l) => l.href === current);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? inside;
  const id = `menu-${group.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={!ready}
        onClick={() => setChosen(!open)}
        className={`${IDLE} w-full text-left disabled:cursor-default`}
      >
        <Icon name="settings" size={18} className="text-ink-muted" />
        <span className="min-w-0 flex-1">{group.label}</span>
        <Icon
          name="chevron"
          size={16}
          className={`text-ink-muted transition-transform duration-200 ease-sd ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>
      <div id={id} hidden={!open} className="flex animate-in flex-col gap-1 pt-1 pl-4">
        {group.links.map((link) => (
          <NavLink
            key={link.href}
            link={link}
            current={current}
            shown={shown}
            pathname={pathname}
          />
        ))}
      </div>
    </div>
  );
}

// Where the pill goes: the row of `href` in `nav`, or nowhere when it isn't showing (in a closed
// group, or not in this role's menu). Its place in the menu's layout, added up box by box, so a
// group still sliding open (its transform makes it the box offsets count from) or a row dipping
// under a press doesn't move it.
export function pillPlace(
  nav: HTMLElement,
  href: string | null,
): { x: number; y: number; w: number; h: number } | null {
  const row = href
    ? [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
        (a) => a.getAttribute("href") === href,
      )
    : undefined;
  if (!row || row.offsetParent === null) return null;
  let x = 0;
  let y = 0;
  let box: Element | null = row;
  while (box instanceof HTMLElement && box !== nav) {
    x += box.offsetLeft;
    y += box.offsetTop;
    box = box.offsetParent;
  }
  if (box !== nav) return null;
  return { x, y, w: row.offsetWidth, h: row.offsetHeight };
}

// Puts the pill on the row of `shown` (or hides it): at once (`instant`, or the first time it
// shows), or sliding there (`slide`, globals.css).
function placePill(
  nav: HTMLElement | null,
  pill: HTMLElement | null,
  shown: string | null,
  instant: boolean,
  placed: { current: boolean },
) {
  if (!nav || !pill) return;
  const at = pillPlace(nav, shown);
  if (!at) {
    pill.style.opacity = "0";
    placed.current = false;
    return;
  }
  const jump = instant || !placed.current;
  if (jump) pill.style.transition = "none";
  pill.style.translate = `${at.x}px ${at.y}px`;
  pill.style.width = `${at.w}px`;
  pill.style.height = `${at.h}px`;
  pill.style.opacity = "1";
  if (jump) {
    void pill.offsetWidth;
    pill.style.transition = "";
  }
  placed.current = true;
}

// The page you're on (or the one you've just picked, while it's on its way): one white pill under
// the rows that slides to it. Placed at once when it first shows and when the menu changes size
// (a group opening), so it only ever slides to a pick.
function Pill({ nav, shown }: { nav: RefObject<HTMLElement | null>; shown: string | null }) {
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    placePill(nav.current, pill.current, shown, false, placed);
  }, [nav, shown]);
  useEffect(() => {
    const box = nav.current;
    if (!box) return;
    const again = () => placePill(box, pill.current, shown, true, placed);
    const sizes = new ResizeObserver(again);
    sizes.observe(box);
    // A group that has slid open: its rows are where they'll stay.
    box.addEventListener("animationend", again);
    return () => {
      sizes.disconnect();
      box.removeEventListener("animationend", again);
    };
  }, [nav, shown]);
  return (
    <span
      ref={pill}
      aria-hidden="true"
      data-menu-pill=""
      className="slide pointer-events-none absolute top-0 left-0 z-0 rounded-row bg-pill opacity-0 shadow-soft"
    />
  );
}

export function OfficeNav({ groups }: { groups: MenuGroup[] }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const nav = useRef<HTMLElement>(null);
  const hrefs = groups.flatMap((g) => g.links.map((l) => l.href));
  const current = currentHref(pathname, hrefs);
  // The link just picked, while its page is on its way: the pill goes there at once.
  const { picked } = useContext(MenuPending);
  const shown = picked && hrefs.includes(picked) ? picked : current;
  return (
    <nav ref={nav} aria-label="Office menu" className="relative flex flex-col gap-1 px-3 pt-1 pb-2">
      {hydrated && <Pill nav={nav} shown={shown} />}
      {groups
        .filter((group) => !group.bottom)
        .map((group) =>
          group.folded ? (
            // Keyed by whether you're on one of its pages, so arriving at one shows it again.
            <Fold
              key={`${group.label}:${group.links.some((l) => l.href === current)}`}
              group={group}
              current={current}
              shown={shown}
              pathname={pathname}
            />
          ) : (
            <div key={group.label}>
              {!group.top && <p className={LABEL}>{group.label}</p>}
              <div className="flex flex-col gap-1">
                {group.links.map((link) => (
                  <NavLink
                    key={link.href}
                    link={link}
                    current={current}
                    shown={shown}
                    pathname={pathname}
                  />
                ))}
              </div>
            </div>
          ),
        )}
    </nav>
  );
}
