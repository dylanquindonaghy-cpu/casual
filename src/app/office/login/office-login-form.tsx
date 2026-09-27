"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TooManyTries } from "../../too-many-tries";
import { requestOfficeLinkAction, type OfficeLoginState } from "./actions";

export function OfficeLoginForm({ firmName, signOff }: { firmName: string; signOff: string }) {
  const [state, action, pending] = useActionState<OfficeLoginState, FormData>(
    requestOfficeLinkAction,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <div role="status" className="mt-6 rounded-xl bg-green-50 p-4">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-2">
          If {firmName} has this address, we&apos;ve sent a login link. It works for 15 minutes.
        </p>
        <p className="mt-2 text-base text-slate-600">{signOff}</p>
        <Link href="/office/login" className="mt-4 inline-block underline">
          Use a different address
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6">
      <label htmlFor="email" className="block font-semibold">
        Your work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={state.status === "invalid_email"}
        className="mt-2 w-full rounded-xl border-2 border-slate-400 px-4 py-3 text-xl"
      />
      {state.status === "invalid_email" && (
        <p className="mt-2 text-red-700">Enter your work email address, like name@example.com.</p>
      )}
      {state.status === "rate_limited" && <TooManyTries minutes={state.retryAfterMinutes} />}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-red-700">
          Something went wrong. Try again.
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
