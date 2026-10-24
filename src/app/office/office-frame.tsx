"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import type { PayWeekParts } from "@/lib/pay/pay-week";
import type { Theme } from "../theme";
import { chip } from "../ui/classes";
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
// Phase 23 (round 3, Dylan's approved mock-up): flat, on a light grey ground. A white top bar the
// window's full width at every width, with a hairline under it: "Menu" (below 1024px), the firm's
// mark on its own colour and its name ("Office" under it from 1024px), the pay week as words with
// "This week" (from 1024px; its dates from 1280px), the shifts line's number (from 1280px, when the
// firm has one), the square light or dark button, and you (your initials; your name from 640px),
// whose account menu (a popover, top right) has your name and role, the same light or dark switch,
// the how-to guide and Log out. From 1024px the menu is its own white card under the bar (it
// stays in view as the page scrolls, and scrolls with no scrollbar only in a window too short for
// it: menu-scroll.tsx), beside the page in another white card (#main's own). Below 1024px "Menu"
// opens the menu as a drawer, a native <dialog> sliding in from the left: the same <nav> moves into
// it while it's open (so a page never has two), Escape, the dimmed backdrop and "Close menu" close
// it, and so does moving to another page or widening the window to 1024px. Closed, the drawer is
// empty, so nothing in it can be reached with the Tab key. Nothing at rest has depth: the account
// menu and the drawer float, with the one soft overlay. Anything pressed dips and springs back
// (`press`).
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
// name, with "Office" under it (`office`: from 1024px in the top bar, always in the drawer).
function Firm({ firmName, office }: { firmName: string; office: string }) {
  return (
    <p className="flex min-w-0 items-center gap-3 leading-tight">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-row bg-brand-bar text-base font-extrabold text-on-brand-bar lg:size-10 lg:text-lg"
      >
        {firmInitial(firmName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold text-ink lg:text-lg">{firmName}</span>
        <span className={office}>Office</span>
      </span>
    </p>
  );
}

// The pay week (D8) as words, not a button: it does nothing when pressed. "Week 43 · 19 Oct –
// 25 Oct · Pay Fri 30 Oct", its dates shown from 1280px (read out at every width), and "This
// week" in green. From 1024px: no room beside Menu.
function PayWeekWords({ payWeek }: { payWeek: PayWeekParts }) {
  return (
    <p className="hidden min-h-11 shrink-0 items-center gap-2 rounded-full border border-line py-1 pr-2 pl-4 whitespace-nowrap text-ink-muted tabular-nums lg:ml-4 lg:flex">
      <span>
        <span className="font-bold text-ink">{payWeek.week}</span>
        <span className="sr-only xl:not-sr-only">
          {" · "}
          {payWeek.dates}
        </span>
        {" · "}
        {payWeek.pay}
      </span>
      <span className={`${chip.base} ${chip.done}`}>This week</span>
    </p>
  );
}

export function OfficeFrame({
  name,
  roleLabel,
  firmName,
  payWeek,
  shiftsLine,
  menu,
  theme,
  rotationDue,
  refresh,
  children,
}: {
  name: string;
  roleLabel: string;
  firmName: string;
  payWeek: PayWeekParts; // "Week 41", "5 Oct – 11 Oct", "Pay Fri 16 Oct" (src/lib/pay/pay-week.ts)
  shiftsLine: string | null; // "+44 7700 900000" (lineWords), or none until the firm has one
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

  // Widened to the menu card's width: the menu goes back beside the page.
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
        <div data-shell="office" className="flex flex-1 flex-col bg-canvas text-base text-ink">
          {/* The top bar: the window's full width at every width, 64px tall from 1024px. */}
          <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-card px-3 sm:gap-3 lg:min-h-16 lg:px-6">
            <button
              type="button"
              aria-controls={DRAWER_ID}
              aria-expanded={open}
              aria-haspopup="dialog"
              disabled={!hydrated}
              onClick={() => setOpen(true)}
              className="press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-card px-4 font-semibold text-ink hover:bg-raised active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
            >
              <Icon name="menu" />
              Menu
            </button>
            <Firm firmName={firmName} office="hidden text-sm text-ink-muted lg:block" />
            <PayWeekWords payWeek={payWeek} />
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              {/* The firm's shifts line (its own WhatsApp, text and calls number): words, from
                  1280px; none until the firm has one. */}
              {shiftsLine ? (
                <p className="hidden min-h-11 items-center gap-2 rounded-full border border-line px-4 font-semibold whitespace-nowrap text-ink tabular-nums xl:flex">
                  <Icon name="phone" size={18} className="text-ink-muted" />
                  <span className="sr-only">Shifts line:</span> {shiftsLine}
                </p>
              ) : null}
              <ThemeButton initial={theme} look="square" />
              <span aria-hidden="true" className="hidden h-7 w-px bg-line xl:block" />
              <button
                type="button"
                popoverTarget={ACCOUNT_MENU_ID}
                className="press inline-flex min-h-11 items-center gap-2 rounded-full p-1 text-left hover:bg-raised active:bg-button-press sm:pr-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-sm font-bold text-ink-muted"
                >
                  {initials(name)}
                </span>
                {/* Your name from 640px; your role for screen readers ("Sam Rota Resourcer"). */}
                <span className="sr-only leading-tight sm:not-sr-only">
                  <span className="block max-w-48 truncate font-semibold text-ink">{name}</span>
                  <span className="sr-only">{` ${roleLabel}`}</span>
                </span>
                <Icon
                  name="chevron"
                  size={16}
                  className="hidden rotate-90 text-ink-muted sm:block"
                />
              </button>
              <div
                id={ACCOUNT_MENU_ID}
                popover="auto"
                className="inset-auto top-16 right-3 m-0 w-64 origin-top-right animate-pop rounded-inner bg-card p-2 text-base text-ink shadow-float lg:top-18 lg:right-6"
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
            className="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] overflow-hidden bg-card p-0 text-base text-ink shadow-float transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:-translate-x-full"
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
                    className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink hover:bg-raised active:bg-button-press"
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
          {/* Under the bar: from 1024px the menu card beside the page card, 16px apart and from
              the window's edges (248px wide, 284px from 1280px); below it, the page card alone. */}
          <div className="flex flex-1 flex-col px-2 pt-3 pb-6 lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:pt-4 xl:grid-cols-[17.75rem_minmax(0,1fr)]">
            {/* The menu card: 16px under the bar, staying there as the page scrolls; it scrolls
                only in a window too short for it, with no scrollbar (an admin's whole menu fits a
                laptop window 640px tall: tests/e2e/office.shell.spec.ts). */}
            <div className="hidden rounded-card border border-line bg-card p-2 lg:sticky lg:top-20 lg:block lg:self-start">
              {open ? null : (
                <MenuScroll className="lg:max-h-[calc(100dvh-7.125rem)]">
                  <OfficeNav groups={menu} />
                </MenuScroll>
              )}
            </div>
            <div
              id="main"
              tabIndex={-1}
              className="flex min-w-0 flex-1 flex-col focus:outline-none"
            >
              {/* The page: a white card with its hairline (Phase 23), 22px round on a phone and
                  28px from 1024px. */}
              <div className="flex-1 rounded-inner border border-line bg-card lg:rounded-card">
                <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
