"use client";

import { useState, useSyncExternalStore } from "react";
import { THEME_COOKIE, type Theme } from "../theme";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";

// The office's moon/sun switch (docs/office-v2.md 3.1): switches between light and dark, and keeps
// the choice in the sd-theme cookie (a year), which the root layout reads so the next page
// arrives in the same colours. Its words say what it switches to ("Switch to dark mode"). Phase
// 22: a row of the account menu (a round button in the top bar and at the menu's foot until
// then). Waits for the page to be ready, so a tap is never lost.

const ONE_YEAR = 60 * 60 * 24 * 365;

// What the device prefers, followed until someone picks a theme.
const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeToDevice(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// The cookie's value, as the browser stores it for every page of this address.
export function themeCookie(theme: Theme, secure: boolean): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function ThemeButton({ initial }: { initial: Theme | undefined }) {
  const hydrated = useHydrated();
  const [chosen, setChosen] = useState(initial);
  const deviceDark = useSyncExternalStore(
    subscribeToDevice,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const shown: Theme = chosen ?? (deviceDark ? "dark" : "light");
  const next: Theme = shown === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Switch to dark mode" : "Switch to light mode";

  const choose = () => {
    document.cookie = themeCookie(next, window.location.protocol === "https:");
    document.documentElement.dataset.theme = next;
    setChosen(next);
  };

  return (
    <button
      type="button"
      disabled={!hydrated}
      onClick={choose}
      className="press flex min-h-11 w-full items-center gap-3 rounded-row px-3 text-left font-medium text-ink hover:bg-quiet-soft active:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon name={shown === "dark" ? "sun" : "moon"} className="text-ink-muted" />
      {label}
    </button>
  );
}
