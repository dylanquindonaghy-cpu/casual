import Link from "next/link";
import { muted, nums, staffBtn } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { KIND_NAMES, type CreateRequestOutcome } from "@/lib/portal/request-kinds";
import { tryAgainText } from "@/lib/portal/copy";

// What the worker sees after "Send request": a confirmation with a reference, or a plain answer,
// each in a slip (Phase 28.9: the shared notice, 28.1), its words unchanged.
export function RequestResult({
  outcome,
}: {
  outcome: Exclude<CreateRequestOutcome, { status: "logged_out" }>;
}) {
  const seeRequests = (
    <Link href="/requests" className={`${staffBtn.primary} mt-3`}>
      See my requests
    </Link>
  );
  switch (outcome.status) {
    case "created":
      return (
        <Slip tone="done" role="status" title={<span className="text-2xl">Request sent.</span>}>
          <p>
            {KIND_NAMES[outcome.kind]}
            {outcome.when ? ` for ${outcome.when}` : ""}
          </p>
          {outcome.asked && <p>You asked for {outcome.asked}.</p>}
          <p className={`mt-1 ${nums}`}>Sent at {outcome.sentAt}.</p>
          <p className={nums}>Reference: {outcome.ref}</p>
          <p className="mt-1">The office will reply. You&apos;ll see the answer in My requests.</p>
          <p className={`mt-1 ${muted}`}>— {outcome.signOff}</p>
          {seeRequests}
        </Slip>
      );
    case "already_open":
      return (
        <Slip
          tone="quiet"
          role="status"
          title={`You've already asked about this shift. Reference: ${outcome.ref}.`}
        >
          <p>The office will reply. You&apos;ll see the answer in My requests.</p>
          {seeRequests}
        </Slip>
      );
    case "not_yours":
      return (
        <Slip
          tone="urgent"
          role="alert"
          title="You can only ask about your own shifts that haven't started."
        />
      );
    case "invalid":
      return <Slip tone="urgent" role="alert" title="Check the form and try again." />;
    case "error":
      return <Slip tone="urgent" role="alert" title={tryAgainText()} />;
  }
}
