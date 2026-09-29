"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { MAX_REQUEST_NOTE, type ReviewOutcome } from "@/lib/portal/request-kinds";
import { askForReviewAction } from "./actions";

type Shown = Exclude<ReviewOutcome, { status: "logged_out" }>;

// "Ask the office to review": an optional note, one button, then the answer in place of the form.
export function ReviewForm({ shiftId }: { shiftId: string }) {
  const router = useRouter();
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
            className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white"
          >
            Show the shift
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-4">
      <label className="block">
        <span className="font-semibold">Anything the office should know? (optional)</span>
        <textarea
          value={note}
          maxLength={MAX_REQUEST_NOTE}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 block w-full rounded-lg border-2 border-slate-300 px-3 py-3"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={send}
        className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Ask the office to review"}
      </button>
      {outcome && (
        <p role="alert" className="mt-3 font-semibold text-red-700">
          {outcome.status === "invalid"
            ? `Keep your note to ${MAX_REQUEST_NOTE} characters or fewer.`
            : "Something went wrong. Try again."}
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
    <Link
      href="/requests"
      className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center font-semibold"
    >
      See my requests
    </Link>
  );
  switch (outcome.status) {
    case "created":
      return (
        <div role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-4">
          <p className="text-xl font-bold">We&apos;ve sent this to the office.</p>
          <p className="mt-1">They&apos;ll look at why you can&apos;t take this shift.</p>
          <p className="mt-2">Sent at {outcome.sentAt}.</p>
          <p>Reference: {outcome.ref}</p>
          <p className="mt-2 text-base">— {outcome.signOff}</p>
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
