"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  ISSUE_LABELS,
  MAX_PAY_QUERY_DETAILS,
  OTHER_DAY,
  PAY_ISSUES,
  PROBLEM_WORDS,
  type RaisePayQueryOutcome,
} from "@/lib/portal/pay-query-kinds";
import { raisePayQueryAction } from "./actions";

const big =
  "mt-4 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white disabled:opacity-60";
const field = "mt-1 w-full rounded-lg border-2 border-slate-400 px-3 py-3 text-lg";
const secondary =
  "mt-4 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold";

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
      <div className="mt-6" role="status">
        <p className="text-2xl font-bold">Pay query sent.</p>
        <p className="mt-2 text-lg">
          {ISSUE_LABELS[outcome.issue]}: {outcome.when}
        </p>
        <p className="mt-1">Sent at {outcome.sentAt}.</p>
        <p className="mt-1">Reference: {outcome.ref}</p>
        <p className="mt-2">
          Payroll will look at it. You&apos;ll see the answer on your pay page.
        </p>
        <p className="mt-2">{outcome.signOff}</p>
        <Link href="/pay" className={big}>
          Back to your pay
        </Link>
      </div>
    );
  }

  const problems = outcome?.status === "invalid" ? outcome.problems : [];
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="pay-shift" className="block text-lg font-semibold">
        Which shift?
      </label>
      <select
        id="pay-shift"
        className={field}
        value={shift}
        onChange={(e) => setShift(e.target.value)}
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
          <label htmlFor="pay-day" className="block text-lg font-semibold">
            Which day?
          </label>
          <input
            id="pay-day"
            type="date"
            min={earliest}
            max={today}
            className={field}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
      )}

      <fieldset className="mt-6">
        <legend className="text-lg font-semibold">What&apos;s wrong?</legend>
        {PAY_ISSUES.map((key) => (
          <label
            key={key}
            className="mt-2 flex items-center gap-3 rounded-lg border-2 border-slate-300 px-3 py-3 text-lg"
          >
            <input
              type="radio"
              name="issue"
              value={key}
              checked={issue === key}
              onChange={() => setIssue(key)}
              className="h-6 w-6"
            />
            {ISSUE_LABELS[key]}
          </label>
        ))}
      </fieldset>

      <label htmlFor="pay-details" className="mt-6 block text-lg font-semibold">
        {issue === "other" ? "Tell payroll what's wrong" : "Tell payroll more (optional)"}
      </label>
      <p className="text-base text-slate-600">Don&apos;t include bank details.</p>
      <textarea
        id="pay-details"
        className={field}
        rows={4}
        maxLength={MAX_PAY_QUERY_DETAILS}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />

      {problems.length > 0 && (
        <ul className="mt-4 font-semibold" role="alert">
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
        <p className="mt-4 font-semibold" role="alert">
          Choose one of your own shifts from the list.
        </p>
      )}
      {outcome?.status === "needs_code" && (
        <p className="mt-4 font-semibold" role="alert">
          Your pay code has run out.{" "}
          <Link href="/pay" className="underline">
            Get a new code
          </Link>
          , then try again.
        </p>
      )}
      {outcome?.status === "error" && (
        <p className="mt-4 font-semibold" role="alert">
          Something went wrong. Try again.
        </p>
      )}
      <button type="submit" className={big} disabled={pending || !ready}>
        Send pay query
      </button>
      <Link href="/pay" className={secondary}>
        Back to your pay
      </Link>
    </form>
  );
}
