"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, label, muted, staffBtn, staffField } from "@/app/ui/classes";
import { TooManyTries } from "../too-many-tries";
import { requestLoginLinkAction, type LoginFormState } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import type { LoginWay } from "@/lib/portal/login-way";

// The words follow how the link goes (P2.7; docs/screens.md `/login`): by WhatsApp or text, by
// email, or not at all yet ("off": no form, so no one waits for a link that can't come).
export function LoginForm({
  firmName,
  signOff,
  way,
}: {
  firmName: string;
  signOff: string;
  way: LoginWay;
}) {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(
    requestLoginLinkAction,
    { status: "idle" },
  );

  if (way === "off") {
    return (
      <div role="note" className="mt-6 rounded-xl border-2 border-attention bg-attention-soft p-4">
        <p className="font-bold">Login links aren&apos;t switched on yet.</p>
        <p className="mt-2">Please contact the office the way you usually do.</p>
        <p className={`mt-2 ${muted}`}>{signOff}</p>
      </div>
    );
  }

  if (state.status === "sent") return <LinkSent firmName={firmName} signOff={signOff} way={way} />;

  return (
    <form action={action} className="mt-6">
      <label htmlFor="mobile" className={label}>
        Your mobile number
      </label>
      <input
        id="mobile"
        name="mobile"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        aria-invalid={state.status === "invalid_number"}
        aria-describedby={state.status === "invalid_number" ? "mobile-error" : undefined}
        className={`${staffField} mt-2 tabular-nums aria-invalid:border-urgent`}
      />
      {state.status === "rate_limited" && <TooManyTries minutes={state.retryAfterMinutes} />}
      {state.status === "error" && (
        <p role="alert" className="mt-2 font-semibold text-urgent">
          {tryAgainText()}
        </p>
      )}
      {state.status === "invalid_number" && (
        <p id="mobile-error" className="mt-2 font-semibold text-urgent">
          Enter a UK mobile number, like 07700 900123.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${staffBtn.primary} mt-4`}>
        {pending ? "Sending…" : way === "email" ? "Email me a link" : "Send me a link"}
      </button>
    </form>
  );
}

// The answer once a link is asked for, the same whether or not the number is known (exported for
// the tests: the form only shows it after a real request).
export function LinkSent({
  firmName,
  signOff,
  way,
}: {
  firmName: string;
  signOff: string;
  way: Exclude<LoginWay, "off">; // with nothing to send there's no form to ask with
}) {
  return (
    <div role="status" className="mt-6 rounded-xl border-2 border-done bg-done-soft p-4">
      {way === "email" ? (
        <>
          <p className="text-2xl font-bold">Check your email.</p>
          <p className="mt-2">
            If {firmName} has this number and your email address, we&apos;ve emailed you a link. It
            works for 15 minutes.
          </p>
          <p className="mt-2">Not there in a few minutes? Look in your junk folder.</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold">Check your phone.</p>
          <p className="mt-2">
            If {firmName} has this number, we&apos;ve sent a link by WhatsApp or text. It works for
            15 minutes.
          </p>
        </>
      )}
      <p className={`mt-2 ${muted}`}>{signOff}</p>
      <Link href="/login" className={`${btn.link} mt-2`}>
        Use a different number
      </Link>
    </div>
  );
}
