"use client";

import { useLinkStatus } from "next/link";
import { createContext, useContext, useEffect, useRef } from "react";

// While a page picked in the office menu is on its way (Phase 21): the link tells the frame
// (office-frame.tsx) as it's picked (its `onNavigate`), and the frame shows that page's skeleton in
// the page's place once it has taken longer than SKELETON_AFTER_MS, until it arrives
// (office-skeleton.tsx). On a phone the drawer shuts as the link is picked, so the skeleton is seen.
// Only in the browser, from the menu's own links: a route-wide loading.tsx would start every page's
// answer before its access check, so a page a role can't open would answer 200 instead of 404 (the
// browser tests caught it).

// `from`: the page the link was picked on. Once the address has moved on, it has arrived.
export type MenuPendingState = { href: string; from: string } | null;
// `start`: a link was picked; `end`: a link that was on its way no longer is (arrived, failed or
// given up for another).
export type MenuPendingApi = { start: (href: string) => void; end: (href: string) => void };

export const MenuPending = createContext<MenuPendingApi>({
  start: () => undefined,
  end: () => undefined,
});

// A page that arrives quicker than this never flashes a skeleton (the system's quickest transition).
export const SKELETON_AFTER_MS = 150;

// Inside a menu link: says when its page, once on its way, no longer is. Draws nothing. Only after
// it has seen it on its way: on a phone the links are drawn afresh as the drawer shuts, and a fresh
// link has never been on its way.
export function MenuPendingReporter({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const { end } = useContext(MenuPending);
  const seen = useRef(false);
  useEffect(() => {
    if (pending) seen.current = true;
    else if (seen.current) {
      seen.current = false;
      end(href);
    }
  }, [href, pending, end]);
  return null;
}

// The page whose skeleton shows, if any: the link still on its way from the page you're on.
export function pendingPage(state: MenuPendingState, pathname: string): string | null {
  if (!state || state.from !== pathname || state.href === pathname) return null;
  return state.href;
}

// The next state when a link is picked (on its way: it's the one shown, the last picked wins) or
// ends (arrived or given up: it goes, unless another link has been picked since).
export function nextPending(
  state: MenuPendingState,
  href: string,
  pending: boolean,
  from: string,
): MenuPendingState {
  if (pending) return { href, from };
  return state?.href === href ? null : state;
}
