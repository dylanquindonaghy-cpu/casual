import Link from "next/link";
import { KIND_NAMES, type CreateRequestOutcome } from "@/lib/portal/request-kinds";
import { tryAgainText } from "@/lib/portal/copy";

// What the worker sees after "Send request": a confirmation with a reference, or a plain answer.
export function RequestResult({
  outcome,
}: {
  outcome: Exclude<CreateRequestOutcome, { status: "logged_out" }>;
}) {
  const seeRequests = (
    <Link
      href="/requests"
      className="mt-3 block w-full rounded-xl bg-slate-900 px-4 py-3 text-center font-semibold text-white"
    >
      See my requests
    </Link>
  );
  switch (outcome.status) {
    case "created":
      return (
        <div role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-4">
          <p className="text-xl font-bold">Request sent.</p>
          <p className="mt-1">
            {KIND_NAMES[outcome.kind]}
            {outcome.when ? ` for ${outcome.when}` : ""}
          </p>
          {outcome.asked && <p>You asked for {outcome.asked}.</p>}
          <p className="mt-2">Sent at {outcome.sentAt}.</p>
          <p>Reference: {outcome.ref}</p>
          <p className="mt-2">The office will reply. You&apos;ll see the answer in My requests.</p>
          <p className="mt-2 text-base">— {outcome.signOff}</p>
          {seeRequests}
        </div>
      );
    case "already_open":
      return (
        <div role="status">
          <p className="font-semibold">
            You&apos;ve already asked about this shift. Reference: {outcome.ref}.
          </p>
          <p>The office will reply. You&apos;ll see the answer in My requests.</p>
          {seeRequests}
        </div>
      );
    case "not_yours":
      return (
        <p role="alert" className="font-semibold">
          You can only ask about your own shifts that haven&apos;t started.
        </p>
      );
    case "invalid":
      return (
        <p role="alert" className="font-semibold text-red-700">
          Check the form and try again.
        </p>
      );
    case "error":
      return (
        <p role="alert" className="font-semibold text-red-700">
          {tryAgainText()}
        </p>
      );
  }
}
