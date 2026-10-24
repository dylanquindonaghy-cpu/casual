"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { THEME_COOKIE, themeFromCookie, type Theme } from "../theme";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";

// The office's light and dark switch (docs/office-v2.md 3.1): switches between light and dark, and
// keeps the choice in the sd-theme cookie (a year), which the root layout reads so the next page
// arrives in the same colours. Its words say what it switches to ("Switch to dark mode"). Phase 23
// (round 3, the approved mock-up): two of them, a square moon or sun button in the top bar (its
// words for screen readers, and shown beside it under the pointer and on keyboard focus) and a row
// of the account menu (Phase 22). Both read the theme from the page itself (<html data-theme>, or
// the device's setting until someone picks one), so they always say the same. Each waits for the
// page to be ready, so a tap is never lost.

const ONE_YEAR = 60 * 60 * 24 * 365;

// The page's theme: the one picked (<html data-theme>, written by the root layout from the cookie
// and by a switch), or what the device prefers until someone picks one. Either switch changing it,
// or the device's setting changing, tells both.
const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeToTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  const picked = new MutationObserver(onChange);
  picked.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    query.removeEventListener("change", onChange);
    picked.disconnect();
  };
}
function pageTheme(): Theme {
  return (
    themeFromCookie(document.documentElement.dataset.theme) ??
    (window.matchMedia(DARK_QUERY).matches ? "dark" : "light")
  );
}

// The cookie's value, as the browser stores it for every page of this address.
export function themeCookie(theme: Theme, secure: boolean): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// What a switch says, for the theme the page is in.
export function themeSwitchLabel(shown: Theme): string {
  return shown === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

// `look`: "row", the account menu's full-width row with its words; "square", the top bar's 44px
// button with the moon or the sun alone (its words its name, and shown beside it under the
// pointer and on keyboard focus). The square's words stay while the pointer moves from the button
// onto them (an invisible bridge covers the 8px between), and Escape puts them away without
// switching (WCAG 1.4.13); the next focus or pointer brings them back.
export function ThemeButton({
  initial,
  look = "row",
}: {
  initial: Theme | undefined;
  look?: "row" | "square";
}) {
  const hydrated = useHydrated();
  // On the server (and until the page is ready), the cookie's theme: light with none.
  const shown = useSyncExternalStore(subscribeToTheme, pageTheme, () => initial ?? "light");
  const next: Theme = shown === "dark" ? "light" : "dark";
  const label = themeSwitchLabel(shown);
  const icon = shown === "dark" ? "sun" : "moon";
  // The square's words, put away with Escape until focus or the pointer leaves or comes back.
  const [away, setAway] = useState(false);
  const square = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (look !== "square") return;
    // Escape while its words show: on the button's focus, or under the pointer (the button or
    // the words themselves).
    const onKey = (e: KeyboardEvent) => {
      const el = square.current;
      if (e.key === "Escape" && el && (el.matches(":hover") || el.contains(document.activeElement)))
        setAway(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [look]);

  const choose = () => {
    document.cookie = themeCookie(next, window.location.protocol === "https:");
    document.documentElement.dataset.theme = next;
  };

  if (look === "square") {
    const back = () => setAway(false);
    return (
      <span
        ref={square}
        onPointerEnter={back}
        onPointerLeave={back}
        className="group/tip relative flex shrink-0"
      >
        <button
          type="button"
          aria-label={label}
          disabled={!hydrated}
          onClick={choose}
          onFocus={back}
          onBlur={back}
          className="peer press inline-flex size-11 items-center justify-center rounded-row border border-line bg-card text-ink hover:bg-raised active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name={icon} />
        </button>
        <span
          aria-hidden="true"
          data-theme-tip=""
          className={`absolute top-full right-0 z-30 mt-2 hidden animate-pop rounded-row bg-ink px-3 py-2 text-sm font-semibold whitespace-nowrap text-on-ink before:absolute before:inset-x-0 before:-top-2 before:h-2${away ? "" : " peer-focus-visible:block pointer-fine:group-hover/tip:block"}`}
        >
          {label}
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={!hydrated}
      onClick={choose}
      className="press flex min-h-11 w-full items-center gap-3 rounded-row px-3 text-left font-medium text-ink hover:bg-raised active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon name={icon} className="text-ink-muted" />
      {label}
    </button>
  );
}
