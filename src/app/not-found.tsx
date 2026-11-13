import type { Metadata } from "next";
import Link from "next/link";
import { page, staffBtn } from "./ui/classes";

// Its tab: "Page not found · Acme Events shifts" ("Page not found · ShiftDesk" on the platform's
// own address; Phase 37.6, w1-09).
export const metadata: Metadata = { title: "Page not found" };

// A link that goes nowhere: an old or mistyped address, a firm address that doesn't exist, or a
// page that's been removed. Plain words instead of "404". "Go to my shifts" goes to the Shifts tab
// (`/shifts`, where her shifts are; 28.12): logged out, it sends her to log in first.
export default function NotFound() {
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
        We can&apos;t find that page.
      </h1>
      <p className="mt-2">The link may be old or mistyped.</p>
      <Link href="/shifts" className={`${staffBtn.primary} mt-6`}>
        Go to my shifts
      </Link>
    </main>
  );
}
