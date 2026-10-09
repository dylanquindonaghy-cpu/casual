"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  CANCEL_REASONS,
  MAX_NOTE_LENGTH,
  OTHER_REASON,
  type CancelShiftOutcome,
  type CancelWarning,
} from "@/lib/portal/cancel-reasons";
import { CANCEL_FOOTER } from "@/lib/strikes/words";
import { labelStack, staffBtn, staffField } from "../ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { cancelShiftAction, cancelWarningAction } from "./actions";
import { CancelShiftResult } from "./cancel-shift-result";

type Shown = Exclude<
  CancelShiftOutcome,
  { status: "logged_out" | "invalid_reason" | "warning_changed" }
>;

const CHANGED = "This has changed since you opened it. Read it again, then confirm.";

// "Cancel this shift" → the strike warning (worked out when the step opens, by the same rule that
// runs on confirm: docs/office-v2.md 4.5) → why (a quick reason, or "Something else" with a short
// note) → "Confirm cancellation" or "Keep this shift" → the confirmation, in place, with whether a
// strike was recorded and "Tell us what happened". If what would happen changed while they read
// it, nothing is cancelled and the new warning is shown. Then "Back to my shifts" reloads the list
// without the cancelled shift. The opener and the confirm look destructive (red outline, then red
// fill); "Keep this shift" is the plain way out. The opener and the choices wait for the page
// (docs/ui-design.md "Forms wait for the page").
export function CancelShift({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [asking, setAsking] = useState(false);
  const [warning, setWarning] = useState<CancelWarning | null>(null);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const open = () => {
    if (sending.current) return;
    sending.current = true;
    setAsking(true);
    setWarning(null);
    setProblem(null);
    startTransition(async () => {
      const result = await cancelWarningAction(shiftId).catch(() => ({ status: "error" as const }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else if (result.status === "ok") setWarning(result.warning);
      else setOutcome(result);
    });
  };

  const confirm = () => {
    if (sending.current || !warning) return;
    if (!choice) return setProblem("Choose a reason.");
    if (choice === OTHER_REASON && !note.trim()) return setProblem("Tell the office why.");
    setProblem(null);
    setOutcome(null);
    sending.current = true;
    const seen = { kind: warning.kind, version: warning.version };
    startTransition(async () => {
      const result = await cancelShiftAction(shiftId, choice, note, seen).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else if (result.status === "invalid_reason") setProblem("Choose a reason.");
      else if (result.status === "warning_changed") {
        setWarning(result.warning);
        setProblem(CHANGED);
      } else setOutcome(result);
    });
  };

  if (outcome) {
    // After an error, the same reason is sent again; otherwise back to the (reloaded) list.
    const retry = outcome.status === "error" && warning !== null;
    return (
      <div className="flex flex-col gap-3">
        <CancelShiftResult outcome={outcome} shiftId={shiftId} />
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
      <button type="button" disabled={!ready} onClick={open} className={staffBtn.danger}>
        Cancel this shift
      </button>
    );
  }
  const keep = (
    <button
      type="button"
      disabled={pending && warning !== null}
      onClick={() => {
        setAsking(false);
        setWarning(null);
        setProblem(null);
      }}
      className={`${staffBtn.secondary} mt-3`}
    >
      Keep this shift
    </button>
  );
  if (!warning) {
    return (
      <div className="flex flex-col">
        <p role="status" className="font-semibold">
          Checking…
        </p>
        {keep}
      </div>
    );
  }
  // The warning first (docs/office-v2.md 4.5), then why.
  return (
    <div className="flex flex-col gap-3">
      <p
        role="note"
        className={`rounded-xl border-2 p-3 ${
          warning.kind === "strike"
            ? "border-urgent bg-urgent-soft font-semibold text-urgent-ink"
            : "border-line-strong bg-quiet-soft"
        }`}
      >
        {warning.text}
      </p>
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
        {keep}
        <p className="mt-3 text-base text-ink-muted">{CANCEL_FOOTER}</p>
      </fieldset>
    </div>
  );
}
