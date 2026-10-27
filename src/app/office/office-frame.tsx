"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import type { Theme } from "../theme";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";
import {
  MenuPending,
  nextPending,
  pendingPage,
  SKELETON_AFTER_MS,
  type MenuPendingApi,
  type MenuPendingState,
} from "./menu-pending";
import { MenuScroll } from "./menu-scroll";
import type { BarCount } from "./office-menu";
import { OfficeNav, type MenuGroup } from "./office-nav";
import { OfficeRail } from "./office-rail";
import { OfficeSearch } from "./office-search";
import { DashboardSkeleton, PageSkeleton } from "./office-skeleton";
import type { SearchResult } from "./search-actions";
import { ThemeButton } from "./theme-button";

// The frame around every office page once someone is logged in (docs/office-v2.md 3.1;
// docs/ui-design.md "Office shell"), drawn by office-shell.tsx. Display only: every page and
// action still checks access.
//
// Phase 24 (round 7 of the canvas, Dylan's "Round 7 exactly, layout too"): on the pastel wash, from
// 1024px, the rail at the left (office-rail.tsx: the firm's mark, the menu as icons or with names)
// and, over the page, a top bar of three floating glass capsules that stays at the top, a soft
// frosted edge fading in behind it once the page scrolls under it: the counts (To fill, Urgent,
// Offers out, To check, Pay queries, each opening where it's worked and only for the roles that can
// open it: office-menu.ts barCounts), the search (office-search.tsx, for the roles that can open what
// it finds) and the light or dark button with you (your initials, name and role) opening the
// account menu (your name and role, the same light or dark switch, the how-to guide and Log out).
// Below 1024px the rail and the first two capsules go and the bar is Phase 23's, as floating glass
// the window's full width: "Menu", the firm's mark and name, the square light or dark button and
// you; "Menu" opens the menu as a drawer, a native <dialog> sliding in from the left: the same
// links (office-nav.tsx) move into it while it's open (so a page never has two menus), Escape, the
// dimmed backdrop and "Close menu" close it, and so does moving to another page or widening the
// window to 1024px. Closed, the drawer is empty, so nothing in it can be reached with the Tab key.
// The pay week moved into the dashboards' lines and the shifts line's number to Settings (Phase
// 24). Glass controls swell under a press; anything else pressed dips and springs back.
//
// The page keeps its own <main>: the frame wraps it in <div id="main"> (the skip link's target),
// and the top bar and menu sit outside it.

export const DRAWER_ID = "office-menu-drawer";
export const ACCOUNT_MENU_ID = "office-account-menu";
const WIDE = "(min-width: 1024px)";

// The shell is drawn by the office layout, which Next keeps (doesn't redraw) as you move between
// office pages. If the session ends on the server (access turned off, "Log out on every device",
// or it ran out), the next click sends you to /office/login and the old frame, name and "Log out"
// would stay around the login card. Arriving at a login page from another page asks the server to
// redraw it once: with no session the frame goes; with one, the login page sends you on to
// /office. Never on the page the frame was drawn on, so it can't repeat.
const LOGIN_PAGES: readonly string[] = ["/office/login", "/office/l"];
export function redrawOnArrival(previous: string, pathname: string): boolean {
  return previous !== pathname && LOGIN_PAGES.includes(pathname);
}

// The firm's initial on its mark: its first letter or digit.
export function firmInitial(firmName: string): string {
  return firmName.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
}

// "Sam Rota" → "SR"; one name → its first letter.
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((w) => w?.match(/\p{L}/u)?.[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

// The firm: its initial on its own colour (the one place the office shows it: Phase 21), then its
// name, with "Office" under it in the drawer. In the top bar below 1024px (the rail has it from
// there).
function Firm({ firmName, office }: { firmName: string; office: string }) {
  return (
    <p className="flex min-w-0 items-center gap-3 leading-tight">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-extrabold text-on-brand-bar"
      >
        {firmInitial(firmName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold text-ink">{firmName}</span>
        <span className={office}>Office</span>
      </span>
    </p>
  );
}

// The first capsule: the counts, each a link that swells under a press, a hairline between them;
// a count that couldn't be read shows its words alone; Urgent's number red while there are any.
// The bar is a container (its column's width changes with the window and the rail): the counts'
// icons show only when there's room for all three capsules with them (1172px: a 1280px window with
// the rail shut), your name (up to 112px) and role from 1008px, the search 250px wide from 1172px
// (200px below); in a column narrower still (the rail open on a 1024px window) the counts scroll
// sideways, with no bar.
function BarCounts({ counts }: { counts: BarCount[] }) {
  if (counts.length === 0) return null;
  return (
    <div
      data-bar-counts=""
      className="glass-float scrollbar-none hidden min-w-0 shrink items-center overflow-x-auto rounded-full p-1 lg:flex"
    >
      {counts.map((c, i) => (
        <span key={c.key} className="flex shrink-0 items-center">
          {i > 0 ? <span aria-hidden="true" className="h-5 w-px bg-line" /> : null}
          <Link
            href={c.href}
            className="press-glass flex h-10 items-center gap-2 rounded-full px-3 text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
          >
            <Icon name={c.icon} size={16} className="hidden @min-[73.25rem]:block" />
            {c.label}
            {/* Read as "To fill 26". */}
            {c.count === null ? null : " "}
            {c.count === null ? null : (
              <b
                className={`font-semibold tabular-nums ${c.urgent ? "text-urgent-ink" : "text-ink"}`}
              >
                {c.count}
                {c.more ? "+" : ""}
              </b>
            )}
          </Link>
        </span>
      ))}
    </div>
  );
}

export function OfficeFrame({
  name,
  roleLabel,
  firmName,
  menu,
  counts,
  search,
  railOpen,
  theme,
  rotationDue,
  refresh,
  children,
}: {
  name: string;
  roleLabel: string;
  firmName: string;
  menu: MenuGroup[];
  counts: BarCount[]; // the top bar's (office-menu.ts barCounts), already for this role
  search: ((q: string) => Promise<SearchResult>) | null; // none: this role can't open what it finds
  railOpen: boolean; // the sd-rail cookie's (rail-cookie.ts)
  theme: Theme | undefined;
  rotationDue: boolean;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const router = useRouter();
  const drawer = useRef<HTMLDialogElement>(null);
  const bar = useRef<HTMLElement>(null);
  const you = useRef<HTMLButtonElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const shownAt = useRef(pathname);
  const [open, setOpen] = useState(false);
  // A page picked in the menu and still on its way: its skeleton in the page's place (Phase 21),
  // once it has taken longer than SKELETON_AFTER_MS (`late` is the pick that has). Picked in the
  // drawer, the drawer shuts at once, so the skeleton is seen on a phone too.
  const [pending, setPending] = useState<MenuPendingState>(null);
  const [late, setLate] = useState<MenuPendingState>(null);
  const start = useCallback(
    (href: string) => {
      setPending((state) => nextPending(state, href, true, pathname));
      drawer.current?.close();
    },
    [pathname],
  );
  const end = useCallback(
    (href: string) => setPending((state) => nextPending(state, href, false, "")),
    [],
  );
  const picked = pendingPage(pending, pathname);
  const menuPending = useMemo<MenuPendingApi>(() => ({ start, end, picked }), [start, end, picked]);
  const loading = pending !== null && late === pending ? picked : null;

  useEffect(() => {
    if (!pending) return;
    const slow = setTimeout(() => setLate(pending), SKELETON_AFTER_MS);
    return () => clearTimeout(slow);
  }, [pending]);

  // Back (or forward) before the page arrived: that pick is given up.
  useEffect(() => {
    const given = () => setPending(null);
    window.addEventListener("popstate", given);
    return () => window.removeEventListener("popstate", given);
  }, []);

  // The drawer opens once its <nav> is in it.
  useEffect(() => {
    const dialog = drawer.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  // Moving to another page closes it (the frame stays, so it would stay open over the new page).
  useEffect(() => {
    drawer.current?.close();
    const previous = shownAt.current;
    shownAt.current = pathname;
    if (redrawOnArrival(previous, pathname)) router.refresh();
  }, [pathname, router]);

  // A press shows on a touch screen as it does with a mouse (Safari draws :active only on a page
  // that listens for touches).
  useEffect(() => {
    const touch = () => undefined;
    document.addEventListener("touchstart", touch, { passive: true });
    return () => document.removeEventListener("touchstart", touch);
  }, []);

  // The page scrolled under the top bar: its frosted edge fades in (`scroll-edge`, from 1024px).
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const onScroll = () => {
      if (window.scrollY > 0) el.dataset.scrolled = "";
      else delete el.dataset.scrolled;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The account menu opens under you, its right edge with yours (the bar's width changes with the
  // window and the rail).
  useEffect(() => {
    const menuEl = account.current;
    const button = you.current;
    if (!menuEl || !button) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = button.getBoundingClientRect();
      menuEl.style.top = `${Math.round(r.bottom + 8)}px`;
      menuEl.style.right = `${Math.round(Math.max(12, document.documentElement.clientWidth - r.right))}px`;
    };
    menuEl.addEventListener("beforetoggle", place);
    return () => menuEl.removeEventListener("beforetoggle", place);
  }, []);

  // Widened to the rail's width: the menu goes back to the rail.
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const onChange = () => {
      if (wide.matches) drawer.current?.close();
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:bg-ink focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-on-ink"
      >
        Skip to content
      </a>
      <MenuPending.Provider value={menuPending}>
        <div
          data-shell="office"
          className="flex flex-1 flex-col text-base text-ink lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-x-3 lg:px-3"
        >
          {/* The rail (from 1024px), with the menu unless the drawer has it. */}
          {open ? null : (
            <OfficeRail
              groups={menu}
              firmName={firmName}
              firmInitial={firmInitial(firmName)}
              initialOpen={railOpen}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col lg:min-h-dvh">
            {/* The top bar: floating glass the window's full width below 1024px; from there three
                capsules over the page, with the frosted edge once it scrolls. */}
            <header
              ref={bar}
              className="@container max-lg:glass-float lg:scroll-edge sticky top-0 z-20 flex min-h-14 items-center gap-2 px-3 sm:gap-3 lg:min-h-0 lg:gap-2 lg:px-0 lg:pt-3 lg:pb-2"
            >
              <button
                type="button"
                aria-controls={DRAWER_ID}
                aria-expanded={open}
                aria-haspopup="dialog"
                disabled={!hydrated}
                onClick={() => setOpen(true)}
                className="press-glass glass-button inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 font-semibold text-ink hover:bg-button-hover active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
              >
                <Icon name="menu" />
                Menu
              </button>
              <div className="min-w-0 lg:hidden">
                <Firm firmName={firmName} office="hidden" />
              </div>
              <BarCounts counts={counts} />
              <span aria-hidden="true" className="min-w-0 flex-1" />
              {search ? <OfficeSearch search={search} /> : null}
              <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:glass-float lg:gap-1 lg:rounded-full lg:p-1">
                <ThemeButton initial={theme} look="square" />
                <button
                  ref={you}
                  type="button"
                  popoverTarget={ACCOUNT_MENU_ID}
                  className="press inline-flex min-h-11 items-center gap-2 rounded-full p-1 text-left hover:bg-raised active:bg-button-press sm:pr-3 lg:min-h-10 lg:py-0 lg:pr-2 lg:pl-1"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full glass-button text-sm font-bold text-ink-muted lg:size-8 lg:glass-rim lg:bg-wait-tile lg:bg-none lg:text-xs lg:font-semibold lg:text-wait-ink"
                  >
                    {initials(name)}
                  </span>
                  {/* Your name from 640px, with your role under it from 1024px (read out at every
                      width: "Sam Rota Resourcer"). */}
                  <span className="sr-only leading-tight sm:not-sr-only lg:sr-only lg:@min-[63rem]:not-sr-only">
                    <span className="block max-w-48 truncate font-semibold text-ink lg:max-w-28 lg:font-medium">
                      {name}
                    </span>
                    <span className="sr-only lg:not-sr-only lg:block lg:text-sm lg:leading-tight lg:text-ink-muted">{` ${roleLabel}`}</span>
                  </span>
                  <Icon
                    name="chevron"
                    size={16}
                    className="hidden rotate-90 text-ink-muted sm:block lg:hidden lg:@min-[63rem]:block"
                  />
                </button>
              </div>
              <div
                ref={account}
                id={ACCOUNT_MENU_ID}
                popover="auto"
                className="inset-auto top-16 right-3 m-0 w-64 origin-top-right animate-pop rounded-inner glass-float p-2 text-base text-ink"
              >
                <p className="mb-1 border-b border-line px-3 pt-2 pb-3 leading-tight">
                  <span className="block font-semibold break-words">{name}</span>
                  <span className="block text-sm text-ink-muted">{roleLabel}</span>
                </p>
                <ThemeButton initial={theme} />
                <Link
                  href="/office/guide"
                  className="press flex min-h-11 items-center gap-3 rounded-row px-3 font-medium hover:bg-raised active:bg-button-press"
                >
                  <Icon name="guide" className="text-ink-muted" />
                  How-to guide
                </Link>
                <LogoutButton
                  kind="office"
                  after="/office/login?out=1"
                  className="press flex min-h-11 w-full items-center gap-3 rounded-row px-3 font-medium text-ink hover:bg-raised active:bg-button-press"
                  icon={<Icon name="logout" className="text-ink-muted" />}
                />
              </div>
            </header>
            <dialog
              ref={drawer}
              id={DRAWER_ID}
              aria-label="Menu"
              onClose={() => setOpen(false)}
              // A click on the backdrop lands on the dialog itself (its content fills it).
              onClick={(e) => {
                if (e.target === e.currentTarget) e.currentTarget.close();
              }}
              className="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] overflow-hidden glass-float p-0 text-base text-ink transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:-translate-x-full"
            >
              {open ? (
                <div className="flex h-full flex-col p-3">
                  {/* The firm, as in the top bar (a <div>: a <header> here would be a second
                      banner). */}
                  <div className="flex items-center justify-between gap-3 pb-3">
                    <Firm firmName={firmName} office="block text-sm text-ink-muted" />
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => drawer.current?.close()}
                      className="press-glass glass-button inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <MenuScroll className="min-h-0 flex-1">
                    <OfficeNav groups={menu} />
                  </MenuScroll>
                </div>
              ) : null}
            </dialog>
            <div
              id="main"
              tabIndex={-1}
              className="flex min-w-0 flex-1 flex-col px-2 pt-3 pb-6 focus:outline-none lg:p-0"
            >
              {/* The page (Phase 24, round 7): no card of its own; its sections are glass on the
                  wash. From 1024px it takes the column's width beside the rail (up to 1600px),
                  under the capsules. */}
              <div className="flex-1">
                <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:max-w-[100rem] lg:px-0 lg:pt-3 lg:pb-8">
                  {loading && (loading === "/office" ? <DashboardSkeleton /> : <PageSkeleton />)}
                  <div hidden={loading !== null}>{children}</div>
                </div>
              </div>
            </div>
          </div>
          <SessionKeeper rotationDue={rotationDue} refresh={refresh} />
        </div>
      </MenuPending.Provider>
    </>
  );
}
