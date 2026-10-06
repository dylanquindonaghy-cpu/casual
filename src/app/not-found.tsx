import Link from "next/link";
import { page, staffBtn } from "./ui/classes";

// A link that goes nowhere: an old or mistyped address, a firm address that doesn't exist, or a
// page that's been removed. Plain words instead of "404".
export default function NotFound() {
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
        We can&apos;t find that page.
      </h1>
      <p className="mt-2">The link may be old or mistyped.</p>
      <Link href="/" className={`${staffBtn.primary} mt-6`}>
        Go to my shifts
      </Link>
    </main>
  );
}
