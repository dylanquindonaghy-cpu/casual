import Link from "next/link";
import type { TakeShiftOutcome } from "@/lib/portal/take-shift";

// What the worker sees after tapping "Take shift" (docs/screens.md copy rules: plain words, and a
// confirmation they can screenshot: what, when, a reference, signed by the firm).
export function TakeShiftResult({
  outcome,
  reviewHref,
}: {
  outcome: Exclude<TakeShiftOutcome, { status: "logged_out" }>;
  reviewHref?: string; // the shift's page, where the worker can ask the office to review
}) {
  switch (outcome.status) {
    case "booked":
      return (
        <div role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-4">
          <p className="text-xl font-bold">You&apos;re booked.</p>
          {outcome.when && <p className="mt-1 font-semibold">{outcome.when}</p>}
          {outcome.role && (
            <p>
              {outcome.role}
              {outcome.siteName ? ` at ${outcome.siteName}` : ""}
            </p>
          )}
          <p className="mt-2">Reference: {outcome.ref}</p>
          <p className="mt-2 text-base">— {outcome.signOff}</p>
          <Link
            href="/"
            className="mt-3 block w-full rounded-xl bg-slate-900 px-4 py-3 text-center font-semibold text-white"
          >
            See my shifts
          </Link>
        </div>
      );
    case "filled":
      return (
        <p role="alert" className="font-semibold">
          Just filled. Someone else took this shift a moment ago.
        </p>
      );
    case "already_assigned":
      return (
        <div role="status">
          <p className="font-semibold">You&apos;re already booked on this shift.</p>
          <Link
            href="/"
            className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center font-semibold"
          >
            See my shifts
          </Link>
        </div>
      );
    case "gone":
      return (
        <p role="alert" className="font-semibold">
          This shift isn&apos;t open any more.
        </p>
      );
    case "not_eligible":
      return (
        <div role="alert">
          <p className="font-semibold">You can&apos;t take this shift:</p>
          <ul className="mt-1 list-disc pl-5">
            {outcome.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-base">If you think this is wrong, ask the office to review it.</p>
          {reviewHref && (
            <Link
              href={reviewHref}
              className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center font-semibold"
            >
              Ask the office to review
            </Link>
          )}
        </div>
      );
    case "not_yet":
      return (
        <p role="alert" className="font-semibold">
          This shift is offered first to people with fewer hours that week. You can take it from{" "}
          {outcome.opensAt}.
        </p>
      );
    case "try_again":
      return (
        <p role="alert" className="font-semibold">
          We can&apos;t confirm this shift right now. Try again in a few minutes.
        </p>
      );
    case "error":
      return (
        <p role="alert" className="font-semibold text-red-700">
          Something went wrong. Try again.
        </p>
      );
  }
}
