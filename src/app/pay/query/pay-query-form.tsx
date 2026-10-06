"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { label, muted, staffBtn, staffField } from "@/app/ui/classes";
import {
  ISSUE_LABELS,
  MAX_PAY_QUERY_DETAILS,
  OTHER_DAY,
  PAY_ISSUES,
  PROBLEM_WORDS,
  type RaisePayQueryOutcome,
} from "@/lib/portal/pay-query-kinds";
import { raisePayQueryAction } from "./actions";

// One answer to pick from, as a big bordered row; the picked one is outlined in ink.
const choice =
  "flex min-h-14 items-center gap-3 rounded-xl border-2 border-line-strong bg-white px-4 py-3 has-checked:border-ink has-checked:bg-quiet-soft";

// "Raise a pay query" (docs/screens.md `/pay/query`): which shift (or a day), what's wrong, and
// anything payroll should know. Large tap targets; the server checks everything again.
export function PayQueryForm({
  shifts,
  today,
  earliest,
}: {
  shifts: { shiftId: string; label: string }[];
  today: string; // yyyy-mm-dd, the firm's date: the latest day that can be chosen
  earliest: string; // yyyy-mm-dd: the earliest (90 days back)
}) {
  const router = useRouter();
  const [shift, setShift] = useState(shifts.length === 0 ? OTHER_DAY : "");
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
        router.replace("/login");
        return;
      }
      setOutcome(result);
    });

  if (outcome?.status === "created") {
    return (
      <div className="rounded-xl border-2 border-done bg-done-soft p-4" role="status">
        <p className="text-2xl font-bold">Pay query sent.</p>
        <p className="mt-2 text-lg font-semibold">
          {ISSUE_LABELS[outcome.issue]}: {outcome.when}
        </p>
        <p className="mt-1 tabular-nums">Sent at {outcome.sentAt}.</p>
        <p className="mt-1 tabular-nums">Reference: {outcome.ref}</p>
        <p className="mt-2">
          Payroll will look at it. You&apos;ll see the answer on your pay page.
        </p>
        <p className={`mt-2 ${muted}`}>{outcome.signOff}</p>
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
            <label key={key} className={choice}>
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
        <ul className="mt-4 space-y-1 font-semibold text-urgent" role="alert">
          {problems.map((p) => (
            <li key={p}>{PROBLEM_WORDS[p]}</li>
          ))}
        </ul>
      )}
      {outcome?.status === "already_open" && (
        <p className="mt-4 font-semibold" role="alert">
          You&apos;ve already asked about this, and payroll has your first message. Reference:{" "}
          {outcome.ref}.
        </p>
      )}
      {outcome?.status === "not_yours" && (
        <p className="mt-4 font-semibold text-urgent" role="alert">
          Choose one of your own shifts from the list.
        </p>
      )}
      {outcome?.status === "needs_code" && (
        <p className="mt-4 font-semibold" role="alert">
          Your pay code has run out.{" "}
          <Link href="/pay" className="underline underline-offset-4">
            Get a new code
          </Link>
          , then try again.
        </p>
      )}
      {outcome?.status === "error" && (
        <p className="mt-4 font-semibold text-urgent" role="alert">
          Something went wrong. Try again.
        </p>
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
