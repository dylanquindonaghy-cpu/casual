"use client";

import { useState, useSyncExternalStore } from "react";
import { THEME_COOKIE, type Theme } from "../theme";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";

// The office's moon/sun button (docs/office-v2.md 3.1): switches between light and dark, and
// keeps the choice in the sd-theme cookie (a year), which the root layout reads so the next page
// arrives in the same colours. Its name says what it switches to; the same words show beside it
// on hover and keyboard focus. Waits for the page to be ready, so a tap is never lost.

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
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        disabled={!hydrated}
        onClick={choose}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-quiet-soft hover:text-ink active:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name={shown === "dark" ? "sun" : "moon"} />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-full right-0 z-30 mt-1 hidden rounded-full bg-ink px-3 py-1 text-sm whitespace-nowrap text-on-ink shadow-soft group-hover:block group-focus-within:block lg:top-auto lg:bottom-full lg:mt-0 lg:mb-1"
      >
        {label}
      </span>
    </span>
  );
}
