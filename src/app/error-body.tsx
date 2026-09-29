import Link from "next/link";

// What the error page says (src/app/error.tsx decides whether the browser is online).
export function ErrorBody({ online, reset }: { online: boolean; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-bold">{online ? "Something went wrong" : "No signal"}</h1>
      {online ? (
        <>
          <p className="mt-2">It&apos;s not you. Try again in a moment.</p>
          <p className="mt-2">If it keeps happening, contact the office.</p>
        </>
      ) : (
        <p className="mt-2">Check your signal and try again.</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white"
      >
        Try again
      </button>
      <Link
        href="/"
        className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-center text-lg font-semibold"
      >
        Go to my shifts
      </Link>
    </main>
  );
}
