"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

// The name in a row of Enquiries' list, as the row's link (Phase 24, 24.4): on a phone (and before
// the page is ready, or with a modifier key) to the message's own page; from 1024px it picks the
// message into the pane beside the list (`?message=`, the page kept), and the chosen one says it's
// the current one (only there: a phone shows no message beside the list). It's given only what it
// draws and where it goes: the row's words and who sent it stay on the server.

// From 1024px the message shows beside the list (the page's grid starts there too).
const WIDE = "(min-width: 64rem)";
// Whether it does now (on the server, and while the page loads: no).
function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", changed);
      return () => m.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function PaneLink({
  href,
  paneHref,
  chosen,
  name,
}: {
  href: string; // the message's own page
  paneHref: string; // this list with the message chosen
  chosen: boolean;
  name: string; // the casual's, or "Unknown number" / "Withheld"
}) {
  const router = useRouter();
  const wide = useWide();
  return (
    <Link
      href={href}
      // Only while it shows beside the list.
      aria-current={chosen && wide ? "true" : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!window.matchMedia(WIDE).matches) return;
        e.preventDefault();
        router.replace(paneHref, { scroll: false });
      }}
      className="press min-w-0 font-semibold break-words text-ink underline-offset-4 before:absolute before:inset-0 before:rounded-row hover:underline"
    >
      {name}
    </Link>
  );
}
