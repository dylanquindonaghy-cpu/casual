"use client";

import { useEffect } from "react";

// "Updated 10:42" in the page's title row (round 8, the pre-build audit's aud-2): when the office
// page last had its figures from the server (./auto-refresh.ts), London time. Every page's title
// row has its place for it, an empty <small data-updated-slot> beside the headline (the shared
// page header's, src/app/ui/page-header.tsx, which can't hold the time itself: it's the same for
// the casual app, which has none; and the dashboard's and Events & sessions' own); the office's
// frame writes the time into it. Shown once the page is in the browser (the server's clock would
// differ from the reader's), and written again on each page and each answer.

const UPDATED_AT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});
export function updatedWords(at: Date): string {
  return `Updated ${UPDATED_AT.format(at)}`;
}

export function UpdatedStamp({ at, page }: { at: Date | null; page: string }) {
  useEffect(() => {
    // The page's own place for it (React leaves its words alone: the page gives it none).
    const slot = document.querySelector("#main [data-updated-slot]");
    if (slot) slot.textContent = at ? updatedWords(at) : "";
  }, [at, page]);
  return null;
}
