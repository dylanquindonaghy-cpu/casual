"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  CANCEL_REASONS,
  MAX_NOTE_LENGTH,
  OTHER_REASON,
  type CancelShiftOutcome,
} from "@/lib/portal/cancel-reasons";
import { labelStack, staffBtn, staffField } from "../ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { cancelShiftAction } from "./actions";
import { CancelShiftResult } from "./cancel-shift-result";

type Shown = Exclude<CancelShiftOutcome, { status: "logged_out" | "invalid_reason" }>;

// "Cancel this shift" → why (a quick reason, or "Something else" with a short note) → "Confirm
// cancellation" or "Keep this shift" → the confirmation, in place. Then "Back to my shifts"
// reloads the list without the cancelled shift. The opener and the confirm look destructive
// (red outline, then red fill); "Keep this shift" is the plain way out. The opener and the choices
// wait for the page (docs/ui-design.md "Forms wait for the page").
export function CancelShift({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [asking, setAsking] = useState(false);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const confirm = () => {
    if (sending.current) return;
    if (!choice) return setProblem("Choose a reason.");
    if (choice === OTHER_REASON && !note.trim()) return setProblem("Tell the office why.");
    setProblem(null);
    setOutcome(null);
    sending.current = true;
    startTransition(async () => {
      const result = await cancelShiftAction(shiftId, choice, note).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else if (result.status === "invalid_reason") setProblem("Choose a reason.");
      else setOutcome(result);
    });
  };

  if (outcome) {
    // After an error, the same reason is sent again; otherwise back to the (reloaded) list.
    const retry = outcome.status === "error";
    return (
      <div className="flex flex-col gap-3">
        <CancelShiftResult outcome={outcome} />
        <button
          type="button"
          disabled={pending}
          onClick={retry ? confirm : () => router.refresh()}
          className={staffBtn.secondary}
        >
          {retry ? "Try again" : "Back to my shifts"}
        </button>
      </div>
    );
  }
  if (!asking) {
    return (
      <button
        type="button"
        disabled={!ready}
        onClick={() => setAsking(true)}
        className={staffBtn.danger}
      >
        Cancel this shift
      </button>
    );
  }
  return (
    <fieldset className="rounded-xl border-2 border-line-strong p-4">
      <legend className="px-1 text-lg font-bold">Why can&apos;t you make it?</legend>
      {[...CANCEL_REASONS, OTHER_REASON].map((reason) => (
        <label key={reason} className="flex min-h-12 items-center gap-3 py-2">
          <input
            type="radio"
            name={`reason-${shiftId}`}
            value={reason}
            checked={choice === reason}
            onChange={() => setChoice(reason)}
            disabled={!ready}
            className="h-6 w-6 shrink-0 accent-ink"
          />
          <span>{reason}</span>
        </label>
      ))}
      {choice === OTHER_REASON && (
        <label className={`${labelStack} mt-2`}>
          <span>Tell the office why</span>
          <input
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            disabled={!ready}
            className={staffField}
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="mt-3 font-semibold text-urgent">
          {problem}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={confirm}
        className={`${staffBtn.dangerSolid} mt-4`}
      >
        {pending ? "Cancelling…" : "Confirm cancellation"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setAsking(false);
          setProblem(null);
        }}
        className={`${staffBtn.secondary} mt-3`}
      >
        Keep this shift
      </button>
    </fieldset>
  );
}
