"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  CANCEL_REASONS,
  MAX_NOTE_LENGTH,
  OTHER_REASON,
  type CancelShiftOutcome,
} from "@/lib/portal/cancel-reasons";
import { cancelShiftAction } from "./actions";
import { CancelShiftResult } from "./cancel-shift-result";

type Shown = Exclude<CancelShiftOutcome, { status: "logged_out" | "invalid_reason" }>;

const bigButton = "mt-3 w-full rounded-xl px-4 py-4 text-lg font-semibold disabled:opacity-60";

// "Cancel this shift" → why (a quick reason, or "Something else" with a short note) → "Confirm
// cancellation" or "Keep this shift" → the confirmation, in place. Then "Back to my shifts"
// reloads the list without the cancelled shift.
export function CancelShift({ shiftId }: { shiftId: string }) {
  const router = useRouter();
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
      <div className="mt-4">
        <CancelShiftResult outcome={outcome} />
        <button
          type="button"
          disabled={pending}
          onClick={retry ? confirm : () => router.refresh()}
          className={`${bigButton} border-2 border-slate-900`}
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
        onClick={() => setAsking(true)}
        className={`${bigButton} border-2 border-slate-400 text-slate-900`}
      >
        Cancel this shift
      </button>
    );
  }
  return (
    <fieldset className="mt-4 rounded-xl border-2 border-slate-300 p-4">
      <legend className="px-1 font-semibold">Why can&apos;t you make it?</legend>
      {[...CANCEL_REASONS, OTHER_REASON].map((reason) => (
        <label key={reason} className="flex min-h-12 items-center gap-3 py-3">
          <input
            type="radio"
            name={`reason-${shiftId}`}
            value={reason}
            checked={choice === reason}
            onChange={() => setChoice(reason)}
            className="h-6 w-6"
          />
          <span>{reason}</span>
        </label>
      ))}
      {choice === OTHER_REASON && (
        <label className="mt-2 block">
          <span className="font-semibold">Tell the office why</span>
          <input
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 block w-full rounded-lg border-2 border-slate-300 px-3 py-3"
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-red-700">
          {problem}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={confirm}
        className={`${bigButton} bg-slate-900 text-white`}
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
        className={`${bigButton} border-2 border-slate-900`}
      >
        Keep this shift
      </button>
    </fieldset>
  );
}
