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
const NO_REASON = "Choose a reason.";
const NO_NOTE = "Tell the office why.";

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
// The opener waits for the page (docs/ui-design.md "Forms wait for the page"). `opener`: one of
// the pass's three buttons (Phase 20: an icon over the words), the small one two to a row, or a
// full-width one (the shift's page). The reasons are four large buttons, two to a row (Phase 20):
// confirming without one says so right under them and puts the focus on the first, to choose.
export function CancelShift({
  shiftId,
  summary,
  opener = "full",
}: {
  shiftId: string;
  summary: CancelSummary;
  opener?: "tile" | "small" | "full";
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
  const firstReason = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLInputElement>(null);
  // A problem with the reason, said right under it: the focus goes to the first reason (none
  // chosen), or to the note ("Something else" without one), to put it right. Moved here, not on
  // a change of `problem`, so a second press with the same problem moves it again.
  const say = (p: typeof NO_REASON | typeof NO_NOTE) => {
    setProblem(p);
    (p === NO_REASON ? firstReason : noteField).current?.focus();
  };

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
    if (!choice) return say(NO_REASON);
    if (choice === OTHER_REASON && !note.trim()) return say(NO_NOTE);
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
      else if (result.status === "invalid_reason") setProblem(NO_REASON);
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
        className={
          opener === "tile"
            ? "flex min-h-17 w-full flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-card px-1.5 text-center text-base leading-tight font-medium text-urgent-ink shadow-lift hover:bg-urgent-soft disabled:cursor-not-allowed disabled:opacity-60"
            : opener === "small"
              ? `${staffBtnSmall} text-urgent-ink`
              : staffBtn.danger
        }
      >
        {opener === "tile" && <Icon name="dropout" size={24} />}
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
              className={`flex items-start gap-2.5 rounded-2xl border p-3.5 text-base ${
                strike
                  ? "border-urgent bg-urgent-tile font-semibold text-urgent-ink"
                  : "border-done bg-done-tile text-done-ink"
              }`}
            >
              <Icon name={strike ? "urgent" : "check"} size={22} className="mt-px" />
              <span>{warning.text}</span>
            </p>
            <fieldset
              aria-describedby={problem && problem !== CHANGED ? `${titleId}-problem` : undefined}
              className="grid grid-cols-2 gap-2"
            >
              <legend className="mb-2 text-lg font-semibold">Why can&apos;t you make it?</legend>
              {[...CANCEL_REASONS, OTHER_REASON].map((reason, i) => (
                // A large button for each (the radio is the whole of it, drawn over it unseen):
                // chosen, it has an ink edge, a sunk ground and bold words.
                <label
                  key={reason}
                  className="relative flex min-h-14 items-center rounded-2xl border-[1.5px] border-line-strong bg-card px-3.5 text-base font-medium shadow-lift has-checked:border-ink has-checked:bg-raised has-checked:font-semibold has-checked:shadow-none has-checked:inset-shadow-sunk has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
                >
                  <input
                    ref={i === 0 ? firstReason : undefined}
                    type="radio"
                    name={`reason-${shiftId}`}
                    value={reason}
                    checked={choice === reason}
                    onChange={() => {
                      setChoice(reason);
                      if (problem !== CHANGED) setProblem(null);
                    }}
                    disabled={!ready}
                    className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-2xl focus-visible:outline-none"
                  />
                  <span>{reason}</span>
                </label>
              ))}
              {choice === OTHER_REASON && (
                <label className={`${labelStack} col-span-2 mt-1`}>
                  <span>Tell the office why</span>
                  <input
                    ref={noteField}
                    type="text"
                    value={note}
                    maxLength={MAX_NOTE_LENGTH}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={!ready}
                    className={staffField}
                  />
                </label>
              )}
              {problem && problem !== CHANGED && (
                <p
                  id={`${titleId}-problem`}
                  role="alert"
                  className="col-span-2 flex items-center gap-1.5 font-semibold text-urgent-ink"
                >
                  <Icon name="urgent" size={18} />
                  {problem}
                </p>
              )}
            </fieldset>
            {problem === CHANGED && (
              <p role="alert" className="font-semibold text-urgent-ink">
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
