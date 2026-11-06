"use client";

import { useEffect, useState } from "react";
import {
  keepOfflineCopy,
  onlineReloadScript,
  reloadWhenOnline,
  stopOfflineCopy,
  stopOnlineReloadScript,
  watchForFreshCopy,
  type OfflinePage,
} from "@/lib/portal/offline";

// Keeps this page (Home or Booked) for when there's no signal (public/sw.js), each time it's shown
// or refreshed (renderedAt changes), or removes the copy when the offline copy is switched off. On
// Home, when the kept copy is what's on screen (its notice showing, marked with when it was kept),
// watches for the fresh page to arrive and opens it (slow but working signal: audit L90). After
// that, `/?fresh` goes back to `/` in the address bar.
//
// On both pages, while the kept copy is on screen, the signal coming back ("online") opens the page
// fresh (Phase 29.6: its notice says it updates when she's back online). The page's HTML carries a
// few lines that do it before this component's code runs, or if it never can (the kept copy can't
// always fetch every script); once it runs, it takes over from them.
export function OfflineCopy({
  enabled,
  renderedAt,
  page = "/",
}: {
  enabled: boolean;
  renderedAt: number;
  page?: OfflinePage;
}) {
  const scriptId = page === "/" ? "offline-reload-home" : "offline-reload-booked";
  // The in-page lines are only ever part of the HTML the server sent (and so of the kept copy):
  // rendered on the server and kept while that HTML is hydrated, never added by a later
  // navigation in the browser (React never runs a script it adds itself).
  const [inHtml] = useState(
    () => typeof document === "undefined" || document.getElementById(scriptId) !== null,
  );
  useEffect(() => {
    if (enabled) keepOfflineCopy(page);
    else void stopOfflineCopy();
  }, [enabled, renderedAt, page]);
  useEffect(() => {
    if (!enabled || page !== "/") return;
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
  }, [enabled, page]);
  useEffect(() => {
    stopOnlineReloadScript();
    const notice = document.querySelector<HTMLElement>("[data-offline-notice]");
    if (!notice || notice.hidden) return;
    return reloadWhenOnline({ path: page });
  }, [page]);
  return inHtml ? (
    <script
      id={scriptId}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: onlineReloadScript(page) }}
    />
  ) : null;
}
