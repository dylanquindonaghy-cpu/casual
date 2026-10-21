"use client";

import { useState, useTransition } from "react";
import {
  MAX_WHAT_HAPPENED,
  noticeText,
  type CancelShiftOutcome,
  type WhatHappenedOutcome,
} from "@/lib/portal/cancel-reasons";
import { tryAgainText } from "@/lib/portal/copy";
import { cancelledText, WHAT_HAPPENED_PROMPT } from "@/lib/strikes/words";
import { labelStack, staffBtn, staffField } from "../ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { whatHappenedAction } from "./actions";

// What the worker sees after confirming a cancellation: an instant confirmation they can
// screenshot (the reference and whether a strike was recorded and until when, what, when, the
// notice recorded, signed by the firm) with "Tell us what happened"; or a plain answer.
export function CancelShiftResult({
  outcome,
  shiftId,
}: {
  outcome: Exclude<
    CancelShiftOutcome,
    { status: "logged_out" | "invalid_reason" | "warning_changed" }
  >;
  shiftId: string;
}) {
  switch (outcome.status) {
    case "cancelled":
      return (
        <div className="flex flex-col gap-3">
          <div role="status" className="rounded-xl bg-quiet-soft p-4">
            <p className="text-lg font-bold">{cancelledText(outcome.ref, outcome.strike)}</p>
            {outcome.when && <p className="mt-2 font-semibold tabular-nums">{outcome.when}</p>}
            {outcome.role && (
              <p>
                {outcome.role}
                {outcome.siteName ? ` at ${outcome.siteName}` : ""}
              </p>
            )}
            <p className="mt-2">You gave {noticeText(outcome.noticeHours)}.</p>
            <p>Recorded at {outcome.recordedAt}.</p>
            <p className="mt-2 text-base text-ink-muted">— {outcome.signOff}</p>
          </div>
          <WhatHappened shiftId={shiftId} />
        </div>
      );
    case "started":
      return (
        <p role="alert" className="font-semibold">
          This shift has already started. Contact the office.
        </p>
      );
    case "not_booked":
      return (
        <p role="alert" className="font-semibold">
          You&apos;re not booked on this shift any more. If you&apos;ve just cancelled it, it&apos;s
          recorded.
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

function whatHappenedText(result: WhatHappenedOutcome): string {
  switch (result.status) {
    case "sent":
      return `Sent to the office. Reference ${result.ref}.`;
    case "already_sent":
      return `You've already told the office about this. Reference ${result.ref}.`;
    case "not_cancelled":
      return "We can't find your cancellation of this shift.";
    case "invalid":
      return `Write what happened (${MAX_WHAT_HAPPENED} characters at most).`;
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "error":
      return tryAgainText();
  }
}

// "If something stopped you, tell us what happened." Their account goes to the office as a request
// about this cancellation (it changes no strike: a person reads it). On the done screen and, for a
// strike that still counts, on Profile (12C.5).
export function WhatHappened({ shiftId }: { shiftId: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<WhatHappenedOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const done = result?.status === "sent" || result?.status === "already_sent";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || done) return;
        startTransition(async () => {
          setResult(
            await whatHappenedAction(shiftId, text).catch(() => ({ status: "error" as const })),
          );
        });
      }}
    >
      <label className={labelStack}>
        <span>{WHAT_HAPPENED_PROMPT}</span>
        <textarea
          value={text}
          maxLength={MAX_WHAT_HAPPENED}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          disabled={!ready || pending || done}
          className={staffField}
        />
      </label>
      {!done && (
        <button
          type="submit"
          disabled={!ready || pending || !text.trim()}
          className={staffBtn.secondary}
        >
          {pending ? "Sending…" : "Send to the office"}
        </button>
      )}
      {result && (
        <p role={done ? "status" : "alert"} className="font-semibold">
          {whatHappenedText(result)}
        </p>
      )}
    </form>
  );
}
