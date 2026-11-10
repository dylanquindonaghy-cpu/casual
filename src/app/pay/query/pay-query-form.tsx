"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { btn, label, muted, staffBtn, staffChoice, staffField } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { CODE_RAN_OUT } from "@/lib/portal/pay-copy";
import {
  ISSUE_LABELS,
  MAX_PAY_QUERY_DETAILS,
  OTHER_DAY,
  PAY_ISSUES,
  PAY_QUERY_PATH,
  PROBLEM_LINKS,
  PROBLEM_WORDS,
  type PayQueryProblem,
  type RaisePayQueryOutcome,
} from "@/lib/portal/pay-query-kinds";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { raisePayQueryAction } from "./actions";

// "Raise a pay query" (docs/screens.md `/pay/query`, "### 28.10"): which shift (or a day), what's
// wrong, and anything payroll should know. Large tap targets; the server checks everything again.
// Phase 28.10: `preselected`, one of her own shifts the page found from ?shift= (else null); the
// choices are the app's choice cards (`staffChoice`); notices are slips; "message the office" and
// "Get a new code" are links, never a dead end. `codeStep`: this page's own address (its code step,
// then back here), worked out by the page.
export function PayQueryForm({
  shifts,
  preselected = null,
  today,
  earliest,
  codeStep = PAY_QUERY_PATH,
}: {
  shifts: { shiftId: string; label: string }[];
  preselected?: string | null;
  today: string; // yyyy-mm-dd, the firm's date: the latest day that can be chosen
  earliest: string; // yyyy-mm-dd: the earliest (90 days back)
  codeStep?: string;
}) {
  const router = useRouter();
  const [shift, setShift] = useState(
    preselected && shifts.some((s) => s.shiftId === preselected)
      ? preselected
      : shifts.length === 0
        ? OTHER_DAY
        : "",
  );
  const [day, setDay] = useState("");
  const [issue, setIssue] = useState("");
  const [details, setDetails] = useState("");
  const [outcome, setOutcome] = useState<RaisePayQueryOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  // The fields and the button wait for the page (docs/ui-design.md "Forms wait for the page").
  const ready = useHydrated();
  const send = () =>
    startTransition(async () => {
      const result = await raisePayQueryAction({ shift, day, issue, details }).catch(
        () => ({ status: "error" }) as const,
      );
      if (result.status === "logged_out") {
        router.replace(LOGIN_AGAIN);
        return;
      }
      setOutcome(result);
    });

  if (outcome?.status === "created") {
    return (
      <div>
        <Slip tone="done" role="status" title="Pay query sent.">
          <p className="font-semibold">
            {ISSUE_LABELS[outcome.issue]}: {outcome.when}
          </p>
          <p className="tabular-nums">Sent at {outcome.sentAt}.</p>
          <p className="tabular-nums">Reference: {outcome.ref}</p>
          <p>Payroll will look at it. You&apos;ll see the answer on your pay page.</p>
          <p className="text-ink-muted">{outcome.signOff}</p>
        </Slip>
        <Link href="/pay" className={`${staffBtn.primary} mt-4`}>
          Back to your pay
        </Link>
      </div>
    );
  }

  const problems = outcome?.status === "invalid" ? outcome.problems : [];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="pay-shift" className={label}>
        Which shift?
      </label>
      <select
        id="pay-shift"
        className={`${staffField} mt-2`}
        value={shift}
        onChange={(e) => setShift(e.target.value)}
        disabled={!ready}
      >
        <option value="" disabled>
          Choose a shift
        </option>
        {shifts.map((s) => (
          <option key={s.shiftId} value={s.shiftId}>
            {s.label}
          </option>
        ))}
        <option value={OTHER_DAY}>A day not in the list</option>
      </select>
      {shift === OTHER_DAY && (
        <div className="mt-4">
          <label htmlFor="pay-day" className={label}>
            Which day?
          </label>
          <input
            id="pay-day"
            type="date"
            min={earliest}
            max={today}
            className={`${staffField} mt-2`}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            disabled={!ready}
          />
        </div>
      )}

      <fieldset className="mt-6">
        <legend className={label}>What&apos;s wrong?</legend>
        <div className="mt-2 space-y-2">
          {PAY_ISSUES.map((key) => (
            <label key={key} className={staffChoice}>
              <input
                type="radio"
                name="issue"
                value={key}
                checked={issue === key}
                onChange={() => setIssue(key)}
                disabled={!ready}
                className="h-6 w-6 shrink-0 accent-ink"
              />
              {ISSUE_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="pay-details" className={`${label} mt-6`}>
        {issue === "other" ? "Tell payroll what's wrong" : "Tell payroll more (optional)"}
      </label>
      <p className={`mt-1 ${muted}`}>Don&apos;t include bank details.</p>
      <textarea
        id="pay-details"
        className={`${staffField} mt-2`}
        rows={4}
        maxLength={MAX_PAY_QUERY_DETAILS}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        disabled={!ready}
      />

      {problems.length > 0 && (
        // The alert is the slip around the list, so the list keeps its own role.
        <Slip tone="urgent" role="alert" className="mt-4">
          <ul role="list" className="space-y-1 font-semibold">
            {problems.map((p) => (
              <li key={p}>
                <ProblemWords problem={p} />
              </li>
            ))}
          </ul>
        </Slip>
      )}
      {outcome?.status === "already_open" && (
        <Slip tone="wait" role="alert" className="mt-4">
          <p className="font-semibold">
            You&apos;ve already asked about this, and payroll has your first message. Reference:{" "}
            {outcome.ref}.
          </p>
        </Slip>
      )}
      {outcome?.status === "not_yours" && (
        <Slip tone="urgent" role="alert" className="mt-4">
          <p className="font-semibold">Choose one of your own shifts from the list.</p>
        </Slip>
      )}
      {outcome?.status === "needs_code" && (
        <Slip tone="attention" role="alert" className="mt-4">
          <p className="font-semibold">
            {CODE_RAN_OUT.before}
            {/* A full page load: the page draws its code step, then comes back here. */}
            <a href={codeStep} className={btn.link}>
              {CODE_RAN_OUT.link}
            </a>
            {CODE_RAN_OUT.after}
          </p>
        </Slip>
      )}
      {outcome?.status === "error" && (
        <Slip tone="urgent" role="alert" className="mt-4">
          <p className="font-semibold">Something went wrong. Try again.</p>
        </Slip>
      )}
      <button type="submit" className={`${staffBtn.primary} mt-6`} disabled={pending || !ready}>
        Send pay query
      </button>
      <Link href="/pay" className={`${staffBtn.secondary} mt-8`}>
        Back to your pay
      </Link>
    </form>
  );
}

// A problem's words, with its link where it has one ("message the office" → Messages).
function ProblemWords({ problem }: { problem: PayQueryProblem }) {
  const words = PROBLEM_WORDS[problem];
  const link = PROBLEM_LINKS[problem];
  const at = link ? words.indexOf(link.text) : -1;
  if (!link || at < 0) return <>{words}</>;
  return (
    <>
      {words.slice(0, at)}
      <Link href={link.href} className={btn.link}>
        {link.text}
      </Link>
      {words.slice(at + link.text.length)}
    </>
  );
}
