"use client";

import Link from "next/link";
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
import { labelStack, staffBtn, staffBtnSmall, staffField } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Sheet } from "./sheet";
import { DateTile } from "../ui/sign";
import { useHydrated } from "@/app/use-hydrated";
import { cancelShiftAction, cancelWarningAction } from "./actions";
import { CancelShiftResult } from "./cancel-shift-result";

type Shown = Exclude<
  CancelShiftOutcome,
  { status: "logged_out" | "invalid_reason" | "warning_changed" }
>;

const CHANGED = "This has changed since you opened it. Read it again, then confirm.";

// What the sheet's top says about the shift: its date tile and one line ("Steward, Sat 24 Oct,
// 14:00–22:00").
export interface CancelSummary {
  dow: string;
  day: string;
  line: string;
}

// "Can't make it?" (Phase 18; docs/office-v2.md 4.5) opens a sheet: the shift, then the strike
// warning (worked out when it opens, by the same rule that runs on confirm: green when no strike,
// red when one), why (a quick reason, or "Something else" with a short note), then "Cancel this
// shift" (red, the final step), "Ask for a change instead" and "Keep my shift". The confirmation
// shows in the sheet ("Done" closes it and reloads the page without the cancelled shift). If what
// would happen changed while they read it, nothing is cancelled and the new warning is shown.
// The opener waits for the page (docs/ui-design.md "Forms wait for the page"). `opener`: the
// pass's small button in its grid, or a full-width one (Booked, the shift's page).
export function CancelShift({
  shiftId,
  summary,
  opener = "full",
}: {
  shiftId: string;
  summary: CancelSummary;
  opener?: "small" | "full";
}) {
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
  // Closed (a second Escape) while the cancellation was being sent: its answer opens it again.
  const reopen = useRef(false);
  const titleId = `cancel-${shiftId}`;

  const open = () => {
    if (sending.current) return;
    sending.current = true;
    setAsking(true);
    setWarning(null);
    setProblem(null);
    setOutcome(null);
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
      if (reopen.current) {
        reopen.current = false;
        setAsking(true);
      }
      if (result.status === "logged_out") router.replace("/login");
      else if (result.status === "invalid_reason") setProblem("Choose a reason.");
      else if (result.status === "warning_changed") {
        setWarning(result.warning);
        setProblem(CHANGED);
      } else setOutcome(result);
    });
  };

  // Closing the sheet after a cancellation reloads the page (the shift has gone from it). While
  // the cancellation is being sent it can't be closed (its buttons wait, Escape and the dim are
  // held); if a browser closes it anyway, the answer opens it again, so she always sees it.
  const close = () => {
    if (sending.current && warning) {
      reopen.current = true;
      setAsking(false);
      return;
    }
    const done = outcome?.status === "cancelled";
    setAsking(false);
    setWarning(null);
    setProblem(null);
    setOutcome(null);
    if (done) router.refresh();
  };

  const strike = warning?.kind === "strike";
  const confirming = pending && warning !== null && outcome === null;
  return (
    <>
      <button
        type="button"
        disabled={!ready}
        onClick={open}
        className={opener === "small" ? `${staffBtnSmall} text-urgent-ink` : staffBtn.danger}
      >
        Can&apos;t make it?
      </button>
      <Sheet open={asking} onClose={close} labelledBy={titleId} locked={confirming}>
        <div className="flex items-center gap-3.5">
          <DateTile dow={summary.dow} day={summary.day} size="sm" />
          <div className="min-w-0">
            <h2 id={titleId} className="text-2xl font-semibold">
              Can&apos;t make it?
            </h2>
            <p className="text-base text-ink-muted">{summary.line}</p>
          </div>
        </div>
        {outcome ? (
          <div className="flex flex-col gap-3">
            <CancelShiftResult outcome={outcome} shiftId={shiftId} />
            {outcome.status === "error" && warning !== null ? (
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className={staffBtn.secondary}
              >
                Try again
              </button>
            ) : (
              <button type="button" onClick={close} className={staffBtn.primary}>
                Done
              </button>
            )}
          </div>
        ) : !warning ? (
          <>
            <p role="status" className="font-semibold">
              Checking…
            </p>
            <button type="button" onClick={close} className={staffBtn.text}>
              Keep my shift
            </button>
          </>
        ) : (
          <>
            {/* The warning first (docs/office-v2.md 4.5), then why. */}
            <p
              role="note"
              className={`flex items-start gap-2.5 rounded-xl p-3.5 text-base ${
                strike ? "bg-urgent-soft font-semibold text-urgent-ink" : "bg-done-soft text-ink"
              }`}
            >
              <Icon
                name={strike ? "urgent" : "check"}
                size={22}
                className={`mt-px ${strike ? "text-urgent" : "text-done"}`}
              />
              <span>{warning.text}</span>
            </p>
            <fieldset className="flex flex-col">
              <legend className="mb-1 text-lg font-semibold">Why can&apos;t you make it?</legend>
              {[...CANCEL_REASONS, OTHER_REASON].map((reason) => (
                <label key={reason} className="flex min-h-12 items-center gap-3 py-1">
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
            </fieldset>
            {problem && (
              <p role="alert" className="font-semibold text-urgent">
                {problem}
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className={staffBtn.dangerSolid}
              >
                {pending ? "Cancelling…" : "Cancel this shift"}
              </button>
              {confirming ? (
                <span aria-disabled="true" className={`${staffBtn.secondary} opacity-60`}>
                  Ask for a change instead
                </span>
              ) : (
                <Link href={`/requests/new?shift=${shiftId}`} className={staffBtn.secondary}>
                  Ask for a change instead
                </Link>
              )}
              <button type="button" disabled={confirming} onClick={close} className={staffBtn.text}>
                Keep my shift
              </button>
            </div>
            <p className="text-base text-ink-muted">{CANCEL_FOOTER}</p>
          </>
        )}
      </Sheet>
    </>
  );
}
