"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { label, labelStack, nums, staffBtn, staffChoice, staffField } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { tryAgainText } from "@/lib/portal/copy";
import {
  ATTENDANCE_SAID,
  ATTENDANCE_SAID_LABELS,
  attendanceOutcomeText,
  CHOOSE_WHAT_HAPPENED,
  holdsContactDetails,
  MARK_WORDS,
  MAX_REQUEST_NOTE,
  NO_CONTACT_DETAILS,
  type AttendanceOutcome,
  type AttendanceSaid,
} from "@/lib/portal/request-kinds";
import { askAboutMarkAction } from "../actions";

type Shown = Exclude<AttendanceOutcome, { status: "logged_out" }>;

// "Tell the office what happened" (Phase 28.13; docs/screens.md "### 28.13"): one of her sessions
// marked worked or not attended in the last 90 days, shown on its own with its mark; "What
// happened?" as two choice cards (none chosen at first); an optional note; "Send to the office".
// The answer is a slip: sent (with the reference), already asked, the mark already says so, or a
// problem. It never changes the mark: a person looks again (28.9's attendance question). The
// fields and the button wait for the page (docs/ui-design.md "Forms wait for the page").
export function AttendanceForm({
  shift,
}: {
  shift: { shiftId: string; when: string; what: string; mark: "completed" | "no_show" };
}) {
  const router = useRouter();
  const [said, setSaid] = useState<AttendanceSaid | "">("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const ready = useHydrated();

  const send = () => {
    if (sending.current) return;
    if (!said) return setProblem(CHOOSE_WHAT_HAPPENED);
    if (holdsContactDetails(note)) return setProblem(NO_CONTACT_DETAILS);
    setProblem(null);
    sending.current = true;
    startTransition(async () => {
      const result = await askAboutMarkAction(shift.shiftId, { said, note }).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else setOutcome(result);
    });
  };

  const done = outcome?.status === "created" || outcome?.status === "already_open";
  const words = outcome ? attendanceOutcomeText(outcome, tryAgainText()) : null;
  const answer = words && (
    <Slip
      tone={words.tone}
      role={words.tone === "urgent" ? "alert" : "status"}
      title={<span className={nums}>{words.title}</span>}
    >
      {words.lines.map((line) => (
        <p key={line} className={nums}>
          {line}
        </p>
      ))}
      {done && (
        <Link href="/requests" className={`${staffBtn.primary} mt-3`}>
          See my requests
        </Link>
      )}
    </Slip>
  );

  return (
    <div className="space-y-6">
      <div className="flex min-h-14 flex-col justify-center rounded-row glass-tile px-4 py-3 text-base text-ink">
        <span className={`font-semibold ${nums}`}>{shift.when}</span>
        <span>{shift.what}</span>
        <span className="mt-1 text-ink-muted">Marked as: {MARK_WORDS[shift.mark]}</span>
      </div>
      {done ? (
        answer
      ) : (
        <>
          <fieldset>
            <legend className={label}>What happened?</legend>
            <div className="mt-2 space-y-2">
              {ATTENDANCE_SAID.map((k) => (
                <label key={k} className={staffChoice}>
                  <input
                    type="radio"
                    name="said"
                    value={k}
                    checked={said === k}
                    onChange={() => setSaid(k)}
                    disabled={!ready}
                    className="h-6 w-6 shrink-0 accent-ink"
                  />
                  <span>{ATTENDANCE_SAID_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className={labelStack}>
            <span>Anything the office should know? (optional)</span>
            <textarea
              value={note}
              maxLength={MAX_REQUEST_NOTE}
              onChange={(e) => setNote(e.target.value)}
              disabled={!ready}
              rows={3}
              className={staffField}
            />
          </label>
          {problem && (
            <p role="alert" className="font-semibold text-urgent-ink">
              {problem}
            </p>
          )}
          {answer}
          <button
            type="button"
            disabled={pending || !ready}
            onClick={send}
            className={staffBtn.primary}
          >
            {pending ? "Sending…" : "Send to the office"}
          </button>
        </>
      )}
    </div>
  );
}
