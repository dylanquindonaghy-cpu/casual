"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, field, label } from "@/app/ui/classes";
import { TooManyTries } from "../../too-many-tries";
import { requestClientLinkAction, type ClientLoginState } from "./actions";

// The work email field and "Send me a link", then "Check your email." (the office login's form,
// in the client's words: docs/screens.md "## Phase 36").
export function ClientLoginForm({ firmName, signOff }: { firmName: string; signOff: string }) {
  const [state, action, pending] = useActionState<ClientLoginState, FormData>(
    requestClientLinkAction,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="mt-6 rounded-row border border-done-line bg-done-soft p-4">
        <p className="font-semibold text-done-ink">Check your email.</p>
        <p className="mt-2">
          If {firmName} has set this address up, we&apos;ve sent a login link. It works for 15
          minutes.
        </p>
        <p className="mt-2 text-base text-ink-muted">{signOff}</p>
        <Link href="/client/login" className={`${btn.link} mt-2`}>
          Use a different address
        </Link>
      </div>
    );
  }

  const invalid = state.status === "invalid_email";
  return (
    <form action={action} className="mt-6">
      <label htmlFor="email" className={label}>
        Your work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={invalid}
        aria-describedby={invalid ? "email-problem" : undefined}
        className={`${field} mt-2 w-full`}
      />
      {invalid && (
        <p id="email-problem" className="mt-2 font-semibold text-urgent-ink">
          Enter your work email address, like name@example.com.
        </p>
      )}
      {state.status === "rate_limited" && <TooManyTries minutes={state.retryAfterMinutes} />}
      {state.status === "error" && (
        <p role="alert" className="mt-2 font-semibold text-urgent-ink">
          Something went wrong. Try again.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${btn.primary} mt-4 w-full`}>
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
