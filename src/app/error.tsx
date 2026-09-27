"use client";

// Shown instead of a raw error screen when a page fails. Plain words; the details are in the
// (masked) server log.
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-2">It&apos;s not you. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white"
      >
        Try again
      </button>
    </main>
  );
}
