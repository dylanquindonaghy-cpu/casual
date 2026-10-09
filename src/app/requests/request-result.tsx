import Link from "next/link";
import { muted, staffBtn } from "@/app/ui/classes";
import { KIND_NAMES, type CreateRequestOutcome } from "@/lib/portal/request-kinds";
import { tryAgainText } from "@/lib/portal/copy";

// What the worker sees after "Send request": a confirmation with a reference, or a plain answer.
export function RequestResult({
  outcome,
}: {
  outcome: Exclude<CreateRequestOutcome, { status: "logged_out" }>;
}) {
  const seeRequests = (
    <Link href="/requests" className={`${staffBtn.primary} mt-4`}>
      See my requests
    </Link>
  );
  switch (outcome.status) {
    case "created":
      return (
        <div role="status" className="rounded-xl border-2 border-done bg-done-soft p-4">
          <p className="text-2xl font-bold">Request sent.</p>
          <p className="mt-1">
            {KIND_NAMES[outcome.kind]}
            {outcome.when ? ` for ${outcome.when}` : ""}
          </p>
          {outcome.asked && <p>You asked for {outcome.asked}.</p>}
          <p className="mt-2 tabular-nums">Sent at {outcome.sentAt}.</p>
          <p className="tabular-nums">Reference: {outcome.ref}</p>
          <p className="mt-2">The office will reply. You&apos;ll see the answer in My requests.</p>
          <p className={`mt-2 ${muted}`}>— {outcome.signOff}</p>
          {seeRequests}
        </div>
      );
    case "already_open":
      return (
        <div role="status" className="rounded-xl border-2 border-line-strong bg-quiet-soft p-4">
          <p className="font-semibold">
            You&apos;ve already asked about this shift. Reference: {outcome.ref}.
          </p>
          <p className="mt-1">The office will reply. You&apos;ll see the answer in My requests.</p>
          {seeRequests}
        </div>
      );
    case "not_yours":
      return (
        <p role="alert" className="font-semibold text-urgent">
          You can only ask about your own shifts that haven&apos;t started.
        </p>
      );
    case "invalid":
      return (
        <p role="alert" className="font-semibold text-urgent">
          Check the form and try again.
        </p>
      );
    case "error":
      return (
        <p role="alert" className="font-semibold text-urgent">
          {tryAgainText()}
        </p>
      );
  }
}
