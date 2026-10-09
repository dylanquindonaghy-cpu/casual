"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, label, muted, staffBtn, staffField } from "@/app/ui/classes";
import { TooManyTries } from "../too-many-tries";
import { requestLoginLinkAction, type LoginFormState } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

export function LoginForm({ firmName, signOff }: { firmName: string; signOff: string }) {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(
    requestLoginLinkAction,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="mt-6 rounded-xl border-2 border-done bg-done-soft p-4">
        <p className="text-2xl font-bold">Check your phone.</p>
        <p className="mt-2">
          If {firmName} has this number, we&apos;ve sent a link by WhatsApp or text. It works for 15
          minutes.
        </p>
        <p className={`mt-2 ${muted}`}>{signOff}</p>
        <Link href="/login" className={`${btn.link} mt-2`}>
          Use a different number
        </Link>
      </div>
    );
  }

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
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
