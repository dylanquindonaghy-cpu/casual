"use client";

import { useEffect, useState } from "react";
import { HOME_SCREEN_HINT_KEY, shouldShowHomeScreenHint } from "@/lib/portal/home-screen";

// "Put your shifts on your home screen", on an iPhone or iPad only (Safari has no install
// button, so it says how). Decided in the browser after the page loads; renders nothing on the
// server.
export function HomeScreenHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(HOME_SCREEN_HINT_KEY) === "dismissed";
    } catch {
      // Storage blocked: show it; "Don't show again" then only lasts for this page.
    }
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    // Reading the device is only possible in the browser, after the page loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(
      shouldShowHomeScreenHint({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone,
        dismissed,
      }),
    );
  }, []);

  if (!show) return null;
  return (
    <section
      aria-labelledby="home-screen-heading"
      className="mt-6 rounded-xl border-2 border-slate-300 bg-slate-50 p-4"
    >
      <h2 id="home-screen-heading" className="font-semibold">
        Put your shifts on your home screen
      </h2>
      <p className="mt-1">
        Open your browser&apos;s Share menu, then tap Add to Home Screen. Your shifts then open in
        one tap.
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(HOME_SCREEN_HINT_KEY, "dismissed");
          } catch {
            // Storage blocked: hidden for this page only.
          }
          setShow(false);
        }}
        className="mt-3 w-full rounded-xl border-2 border-slate-900 px-4 py-3 font-semibold"
      >
        Don&apos;t show again
      </button>
    </section>
  );
}
