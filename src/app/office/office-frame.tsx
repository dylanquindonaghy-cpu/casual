"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoutButton } from "../logout-button";
import { SessionKeeper } from "../session-keeper";
import type { Theme } from "../theme";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";
import { OfficeNav, type MenuGroup } from "./office-nav";
import { ThemeButton } from "./theme-button";

// The frame around every office page once someone is logged in (docs/office-v2.md 3.1;
// docs/ui-design.md "Office shell"), drawn by office-shell.tsx. Display only: every page and
// action still checks access.
//
// The top bar: the Menu button (below 1024px), ShiftDesk's mark with the firm's name, the pay
// week (from 1024px), the bell (admins and resourcers: "Needs attention, N", a link to that section
// of the dashboard), the moon/sun button and the account button (How-to guide, Log out). From
// 1024px the menu is a
// 272px sidebar. Below that, the Menu button opens it as a drawer, a native <dialog>: the same
// <nav> moves into it while it's open (so a page never has two), Escape, the dimmed backdrop and
// "Close menu" close it, and so does moving to another page or widening the window to 1024px.
// Closed, the drawer is empty, so nothing in it can be reached with the Tab key.
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
  bell = null,
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
  // The bell (admins and resourcers): its name ("Needs attention, 3") and the number it shows
  // (null: none, when there's nothing or it couldn't be read).
  bell?: { label: string; shown: string | null } | null;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const router = useRouter();
  const drawer = useRef<HTMLDialogElement>(null);
  const shownAt = useRef(pathname);
  const [open, setOpen] = useState(false);

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
      <div data-shell="office" className="flex flex-1 flex-col bg-card text-base text-ink">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-panel px-3 sm:gap-3 lg:px-8">
          <button
            type="button"
            aria-controls={DRAWER_ID}
            aria-expanded={open}
            aria-haspopup="dialog"
            disabled={!hydrated}
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-3 font-semibold text-ink hover:bg-quiet-soft disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
          >
            <Icon name="menu" />
            Menu
          </button>
          {/* The firm's name: in the menu from 1024px (Phase 18), here below that. */}
          <p className="min-w-0 truncate leading-tight font-semibold text-ink lg:hidden">
            {firmName}
          </p>
          {/* The pay week (docs/office-v2.md D8). Not on phones or tablets: no room beside Menu. */}
          <p className="hidden text-base text-ink-muted tabular-nums lg:block">{payWeek}</p>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {bell && (
              <Link
                href="/office/needs-attention"
                aria-label={bell.label}
                title={bell.label}
                className="relative inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-quiet-soft"
              >
                <Icon name="bell" />
                {bell.shown && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-0.5 min-w-5 rounded bg-brand px-1 text-center text-xs leading-5 font-bold text-on-brand tabular-nums"
                  >
                    {bell.shown}
                  </span>
                )}
              </Link>
            )}
            <ThemeButton initial={theme} />
            <button
              type="button"
              popoverTarget={ACCOUNT_MENU_ID}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-quiet-soft sm:px-2"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-quiet-soft text-sm font-bold text-quiet-ink"
              >
                {initials(name)}
              </span>
              <span className="sr-only leading-tight sm:not-sr-only">
                <span className="block max-w-48 truncate font-semibold text-ink">{name}</span>
                <span className="block text-sm text-ink-muted">{roleLabel}</span>
              </span>
              <Icon name="chevron" className="hidden rotate-90 text-ink-muted sm:block" />
            </button>
            <div
              id={ACCOUNT_MENU_ID}
              popover="auto"
              className="inset-auto top-14 right-3 m-0 w-60 rounded-xl border border-line bg-card p-2 text-base text-ink shadow-sm lg:right-6"
            >
              <p className="px-3 pt-2 pb-1 leading-tight">
                <span className="block font-semibold break-words">{name}</span>
                <span className="block text-sm text-ink-muted">{roleLabel}</span>
              </p>
              <Link
                href="/office/guide"
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-quiet-soft"
              >
                <Icon name="guide" className="text-ink-muted" />
                How-to guide
              </Link>
              <LogoutButton
                kind="office"
                after="/office/login?out=1"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 font-medium text-ink hover:bg-quiet-soft"
                icon={<Icon name="logout" className="text-ink-muted" />}
              />
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="hidden border-r border-line bg-canvas lg:sticky lg:top-14 lg:flex lg:h-[calc(100dvh-3.5rem)] lg:flex-col lg:self-start lg:overflow-y-auto">
            {open ? null : <OfficeNav groups={menu} firmName={firmName} />}
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
            className="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-80 max-w-[85vw] bg-canvas p-0 text-base text-ink backdrop:animate-fade backdrop:bg-scrim/50"
          >
            {open ? (
              <div className="flex min-h-full flex-col">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <p className="px-3 font-bold">Menu</p>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => drawer.current?.close()}
                    className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-quiet-soft"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <OfficeNav groups={menu} firmName={firmName} />
              </div>
            ) : null}
          </dialog>
          <div id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-10 lg:py-8">{children}</div>
          </div>
        </div>
        <SessionKeeper rotationDue={rotationDue} refresh={refresh} />
      </div>
    </>
  );
}
