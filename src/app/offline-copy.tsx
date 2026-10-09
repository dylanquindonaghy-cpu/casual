"use client";

import { useEffect } from "react";
import { keepOfflineCopy, stopOfflineCopy, watchForFreshCopy } from "@/lib/portal/offline";

// Keeps My shifts for when there's no signal (public/sw.js), each time it's shown or refreshed
// (renderedAt changes), or removes the copy when the offline copy is switched off. When the kept
// copy is what's on screen (its notice showing, marked with when it was kept), watches for the
// fresh page to arrive and opens it (slow but working signal: audit L90). After that, `/?fresh`
// goes back to `/` in the address bar.
export function OfflineCopy({ enabled, renderedAt }: { enabled: boolean; renderedAt: number }) {
  useEffect(() => {
    if (enabled) keepOfflineCopy();
    else void stopOfflineCopy();
  }, [enabled, renderedAt]);
  useEffect(() => {
    if (!enabled) return;
    // After the router has hooked into the history (its own effect runs after this one), keeping
    // its state, so Back and later navigations still work.
    let tidy: ReturnType<typeof setTimeout> | undefined;
    if (window.location.search === "?fresh") {
      tidy = setTimeout(() => window.history.replaceState(window.history.state, "", "/"), 0);
    }
    const notice = document.querySelector<HTMLElement>("[data-offline-notice][data-kept-at]");
    const shownKeptAt = notice && !notice.hidden ? notice.dataset.keptAt : undefined;
    const stop = shownKeptAt ? watchForFreshCopy({ shownKeptAt }) : undefined;
    return () => {
      if (tidy) clearTimeout(tidy);
      stop?.();
    };
  }, [enabled]);
  return null;
}
