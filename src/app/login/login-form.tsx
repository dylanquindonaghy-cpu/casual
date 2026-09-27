"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TooManyTries } from "../too-many-tries";
import { requestLoginLinkAction, type LoginFormState } from "./actions";

export function LoginForm({ firmName, signOff }: { firmName: string; signOff: string }) {
  const [state, action, pending] = useActionState<LoginFormState, FormData>(
    requestLoginLinkAction,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="mt-6 rounded-xl bg-green-50 p-4">
        <p className="font-semibold">Check your phone.</p>
        <p className="mt-2">
          If {firmName} has this number, we&apos;ve sent a link by WhatsApp or text. It works for 15
          minutes.
        </p>
        <p className="mt-2 text-base text-slate-600">{signOff}</p>
        <Link href="/login" className="mt-4 inline-block underline">
          Use a different number
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6">
      <label htmlFor="mobile" className="block font-semibold">
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
        className="mt-2 w-full rounded-xl border-2 border-slate-400 px-4 py-3 text-xl"
      />
      {state.status === "rate_limited" && <TooManyTries minutes={state.retryAfterMinutes} />}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-red-700">
          Something went wrong. Try again.
        </p>
      )}
      {state.status === "invalid_number" && (
        <p id="mobile-error" className="mt-2 text-red-700">
          Enter a UK mobile number, like 07700 900123.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
