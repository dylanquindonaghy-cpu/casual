import Link from "next/link";

// A link that goes nowhere: an old or mistyped address, a firm address that doesn't exist, or a
// page that's been removed. Plain words instead of "404".
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">We can&apos;t find that page.</h1>
      <p className="mt-2">The link may be old or mistyped.</p>
      <Link
        href="/"
        className="mt-6 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
      >
        Go to my shifts
      </Link>
    </main>
  );
}
