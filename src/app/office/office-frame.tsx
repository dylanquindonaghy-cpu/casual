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
import { OfficeNav, type MenuGroup } from "./office-nav";
import { DashboardSkeleton, PageSkeleton } from "./office-skeleton";
import { ThemeButton } from "./theme-button";

// The frame around every office page once someone is logged in (docs/office-v2.md 3.1;
// docs/ui-design.md "Office shell"), drawn by office-shell.tsx. Display only: every page and
// action still checks access.
//
// Below 1024px, the top bar: the Menu button, the firm's name, the moon/sun button and the
// account button (How-to guide, Log out); the Menu button opens the menu as a drawer, a native
// <dialog>: the same <nav> moves into it while it's open (so a page never has two), Escape, the
// dimmed backdrop and "Close menu" close it, and so does moving to another page or widening the
// window to 1024px. Closed, the drawer is empty, so nothing in it can be reached with the Tab key.
// From 1024px (Phase 20) there's no top bar: the menu is a 248px sidebar. Needs attention is a
// menu link with its count (the bell's place until Phase 20). Phase 22 (round 2, Dylan's approved
// mock-up): the menu on the window's warm grey ground and the page as a sheet set into the window,
// rounded and raised (below 1024px, a sheet with rounded top corners under the top bar); from
// 1024px the same <header> sits over the menu, with the firm (its initial and name) and you (the
// account button), and the menu scrolls under it with no scrollbar (menu-scroll.tsx), the pay week
// (D8) at its end. The moon/sun button is a row of the account menu, with the how-to guide (the
// menu's foot until then). Anything pressed dips and springs back (`press`).
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

// "Sam Rota" → "SR"; one name → its first letter.
// "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct" (payWeekLabel) → the week and its dates, then the
// pay day: the two lines at the menu's foot (Phase 21), each kept whole.
export function payWeekLines(label: string): [string, string] {
  const at = label.lastIndexOf(" · ");
  return at < 0 ? [label, ""] : [label.slice(0, at), label.slice(at + 3)];
}

// The firm's initial over the menu: its first letter or digit.
export function firmInitial(firmName: string): string {
  return firmName.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
}

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((w) => w?.match(/\p{L}/u)?.[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

export function OfficeFrame({
  name,
  roleLabel,
  firmName,
  payWeek,
  menu,
  theme,
  rotationDue,
  refresh,
  children,
}: {
  name: string;
  roleLabel: string;
  firmName: string;
  payWeek: string; // "Week 41 · 5 Oct – 11 Oct · Pay Fri 16 Oct" (src/lib/pay/pay-week.ts)
  menu: MenuGroup[];
  theme: Theme | undefined;
  rotationDue: boolean;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const router = useRouter();
  const drawer = useRef<HTMLDialogElement>(null);
  const shownAt = useRef(pathname);
  const [open, setOpen] = useState(false);
  const [week, payDay] = payWeekLines(payWeek);
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

  // Widened to the sidebar's width: the menu goes back beside the page.
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
          className="grain-soft flex flex-1 flex-col bg-canvas text-base text-ink lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]"
        >
          <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 bg-canvas/85 px-3 backdrop-blur-md sm:gap-3 lg:fixed lg:top-0 lg:left-0 lg:z-30 lg:min-h-14 lg:w-62 lg:bg-canvas lg:backdrop-blur-none">
            <button
              type="button"
              aria-controls={DRAWER_ID}
              aria-expanded={open}
              aria-haspopup="dialog"
              disabled={!hydrated}
              onClick={() => setOpen(true)}
              className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-button-line bg-button px-4 font-semibold text-ink shadow-raise hover:bg-button-hover active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
            >
              <Icon name="menu" />
              Menu
            </button>
            {/* The firm: its name in the bar below 1024px; over the menu from there, with its
                initial on its own colour (the one place the office shows it: Phase 21). */}
            <p className="flex min-w-0 items-center gap-3 leading-tight lg:flex-1 lg:px-1">
              <span
                aria-hidden="true"
                className="hidden size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-semibold text-on-brand-bar shadow-raise lg:flex"
              >
                {firmInitial(firmName)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{firmName}</span>
                <span className="hidden text-sm text-ink-muted lg:block">Office</span>
              </span>
            </p>
            <div className="ml-auto flex shrink-0 items-center lg:ml-0">
              <button
                type="button"
                popoverTarget={ACCOUNT_MENU_ID}
                className="press inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-left hover:bg-active/70 active:bg-active sm:px-2 lg:px-1"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-on-ink shadow-raise"
                >
                  {initials(name)}
                </span>
                <span className="sr-only leading-tight sm:not-sr-only lg:sr-only">
                  <span className="block max-w-48 truncate text-sm font-semibold text-ink">
                    {name}
                  </span>
                  <span className="block text-sm text-ink-muted">{roleLabel}</span>
                </span>
                <Icon
                  name="chevron"
                  className="hidden rotate-90 text-ink-muted sm:block lg:hidden"
                />
              </button>
              <div
                id={ACCOUNT_MENU_ID}
                popover="auto"
                className="inset-auto top-14 right-3 m-0 w-64 origin-top-right animate-pop rounded-card bg-card p-2 text-base text-ink shadow-float lg:top-14 lg:right-auto lg:left-3 lg:origin-top-left"
              >
                <p className="px-3 pt-2 pb-2 leading-tight">
                  <span className="block font-semibold break-words">{name}</span>
                  <span className="block text-sm text-ink-muted">{roleLabel}</span>
                </p>
                <ThemeButton initial={theme} />
                <Link
                  href="/office/guide"
                  className="press flex min-h-11 items-center gap-3 rounded-row px-3 font-medium hover:bg-quiet-soft active:bg-raised"
                >
                  <Icon name="guide" className="text-ink-muted" />
                  How-to guide
                </Link>
                <LogoutButton
                  kind="office"
                  after="/office/login?out=1"
                  className="press flex min-h-11 w-full items-center gap-3 rounded-row px-3 font-medium text-ink hover:bg-quiet-soft active:bg-raised"
                  icon={<Icon name="logout" className="text-ink-muted" />}
                />
              </div>
            </div>
          </header>
          {/* The menu, under the firm and you, scrolling only if the window is too short for it,
              with no scrollbar; the pay week (D8) at its end, on two lines that don't break
              mid-date (Phase 21). Not on phones or tablets: no room beside Menu. */}
          <div className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start lg:pt-14">
            {open ? null : (
              <MenuScroll className="min-h-0 flex-1">
                <OfficeNav groups={menu} />
                <p className="mx-6 mt-2 mb-4 border-t border-line pt-3 text-sm text-ink-muted tabular-nums">
                  <span className="block whitespace-nowrap">{week}</span>
                  {payDay && (
                    <>
                      <span className="sr-only"> · </span>
                      <span className="block font-medium whitespace-nowrap text-ink">{payDay}</span>
                    </>
                  )}
                </p>
              </MenuScroll>
            )}
          </div>
          <dialog
            ref={drawer}
            id={DRAWER_ID}
            aria-label="Menu"
            onClose={() => setOpen(false)}
            // A click on the backdrop lands on the dialog itself (its content fills it).
            onClick={(e) => {
              if (e.target === e.currentTarget) e.currentTarget.close();
            }}
            className="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] overflow-hidden rounded-r-card bg-canvas p-0 text-base text-ink shadow-float backdrop:animate-fade backdrop:bg-scrim/50"
          >
            {open ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="px-3 font-semibold">Menu</p>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => drawer.current?.close()}
                    className="press inline-flex size-11 items-center justify-center rounded-full hover:bg-active/70 active:bg-active"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <MenuScroll className="min-h-0 flex-1 pb-4">
                  <OfficeNav groups={menu} />
                </MenuScroll>
              </div>
            ) : null}
          </dialog>
          <div
            id="main"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col focus:outline-none lg:py-2 lg:pr-2"
          >
            {/* The page: a sheet set into the window (Phase 22). */}
            <div className="grain-soft flex-1 rounded-t-card bg-sheet shadow-sheet lg:rounded-card">
              <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-12 lg:py-12">
                {loading && (loading === "/office" ? <DashboardSkeleton /> : <PageSkeleton />)}
                <div hidden={loading !== null}>{children}</div>
              </div>
            </div>
          </div>
          <SessionKeeper rotationDue={rotationDue} refresh={refresh} />
        </div>
      </MenuPending.Provider>
    </>
  );
}
