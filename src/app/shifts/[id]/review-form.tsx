"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { MAX_REQUEST_NOTE, type ReviewOutcome } from "@/lib/portal/request-kinds";
import { askForReviewAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import { labelStack, staffBtn, staffField } from "../../ui/classes";
import { useHydrated } from "@/app/use-hydrated";

type Shown = Exclude<ReviewOutcome, { status: "logged_out" }>;

// "Ask the office to review": an optional note, one button, then the answer in place of the form.
// The note and the button wait for the page (docs/ui-design.md "Forms wait for the page").
export function ReviewForm({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const send = () => {
    if (sending.current) return;
    sending.current = true;
    startTransition(async () => {
      const result = await askForReviewAction(shiftId, note).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else setOutcome(result);
    });
  };

  if (outcome && outcome.status !== "invalid" && outcome.status !== "error") {
    return (
      <div className="mt-4">
        <ReviewResult outcome={outcome} />
        {outcome.status === "eligible_now" && (
          <button
            type="button"
            onClick={() => router.refresh()}
            className={`${staffBtn.primary} mt-3`}
          >
            Show the shift
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-4">
      <label className={labelStack}>
        <span>Anything the office should know? (optional)</span>
        <textarea
          value={note}
          maxLength={MAX_REQUEST_NOTE}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          disabled={!ready}
          className={staffField}
        />
      </label>
      <button
        type="button"
        disabled={pending || !ready}
        onClick={send}
        className={`${staffBtn.primary} mt-4`}
      >
        {pending ? "Sending…" : "Ask the office to review"}
      </button>
      {outcome && (
        <p role="alert" className="mt-3 font-semibold text-urgent">
          {outcome.status === "invalid"
            ? `Keep your note to ${MAX_REQUEST_NOTE} characters or fewer.`
            : tryAgainText()}
        </p>
      )}
    </div>
  );
}

// The answer (exported for the tests).
export function ReviewResult({
  outcome,
}: {
  outcome: Exclude<Shown, { status: "invalid" } | { status: "error" }>;
}) {
  const myRequests = (
    <Link href="/requests" className={`${staffBtn.secondary} mt-4`}>
      See my requests
    </Link>
  );
  switch (outcome.status) {
    case "created":
      return (
        <div role="status" className="rounded-xl border-2 border-done bg-done-soft p-4">
          <p className="text-2xl font-bold text-done-ink">We&apos;ve sent this to the office.</p>
          <p className="mt-1">They&apos;ll look at why you can&apos;t take this shift.</p>
          <p className="mt-2">Sent at {outcome.sentAt}.</p>
          <p className="font-semibold tabular-nums">Reference: {outcome.ref}</p>
          <p className="mt-2 text-base text-ink-muted">— {outcome.signOff}</p>
          {myRequests}
        </div>
      );
    case "already_open":
      return (
        <div role="status">
          <p className="font-semibold">
            You&apos;ve already asked the office to review this shift. Reference: {outcome.ref}.
          </p>
          {myRequests}
        </div>
      );
    case "eligible_now":
      return (
        <p role="status" className="font-semibold">
          Good news: this shift isn&apos;t blocked any more.
        </p>
      );
    case "already_booked":
      return (
        <p role="status" className="font-semibold">
          You&apos;re already booked on this shift.
        </p>
      );
    case "not_open":
      return (
        <p role="alert" className="font-semibold">
          This shift isn&apos;t open any more.
        </p>
      );
  }
}
