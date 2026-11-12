"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The client's two pages in their frame (Phase 36.3), the one you're on marked (an event's page and
// the request form belong to Your events; Your requests is its own).
const navLink =
  "press inline-flex min-h-11 items-center rounded-full px-3 text-base font-semibold text-ink-muted hover:bg-button-hover hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink";

export function ClientNav() {
  const path = usePathname();
  const requests = path === "/client/requests";
  return (
    <nav aria-label="Your pages" className="flex flex-wrap gap-1">
      <Link href="/client" aria-current={!requests ? "page" : undefined} className={navLink}>
        Your events
      </Link>
      <Link
        href="/client/requests"
        aria-current={requests ? "page" : undefined}
        className={navLink}
      >
        Your requests
      </Link>
    </nav>
  );
}
