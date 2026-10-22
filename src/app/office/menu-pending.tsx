"use client";

import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";

// While a page picked in the office menu is on its way (Phase 21): each menu link tells the frame
// (office-frame.tsx), which shows that page's skeleton in the page's place until it arrives
// (office-skeleton.tsx). Only in the browser, from the menu's own links: a route-wide loading.tsx
// would start every page's answer before its access check, so a page a role can't open would
// answer 200 instead of 404 (the browser tests caught it).

// `from`: the page the link was picked on. Once the address has moved on, it has arrived.
export type MenuPendingState = { href: string; from: string } | null;
export type MenuPendingReport = (href: string, pending: boolean, from: string) => void;

export const MenuPending = createContext<MenuPendingReport>(() => undefined);

// A page that arrives quicker than this never flashes a skeleton (the system's quickest transition).
export const SKELETON_AFTER_MS = 150;

// Inside a menu link: says whether its page is on its way. Draws nothing.
export function MenuPendingReporter({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const report = useContext(MenuPending);
  const pathname = usePathname();
  useEffect(() => {
    if (!pending) return report(href, false, pathname);
    const slow = setTimeout(() => report(href, true, pathname), SKELETON_AFTER_MS);
    return () => clearTimeout(slow);
  }, [href, pending, pathname, report]);
  return null;
}

// The page whose skeleton shows, if any: the link still on its way from the page you're on.
export function pendingPage(state: MenuPendingState, pathname: string): string | null {
  if (!state || state.from !== pathname || state.href === pathname) return null;
  return state.href;
}

// The next state when a link reports: on its way, it's the one shown (the last picked wins);
// arrived or given up, it goes, unless another link has been picked since.
export function nextPending(
  state: MenuPendingState,
  href: string,
  pending: boolean,
  from: string,
): MenuPendingState {
  if (pending) return { href, from };
  return state?.href === href ? null : state;
}
