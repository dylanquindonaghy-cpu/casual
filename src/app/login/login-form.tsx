"use client";

import Link from "next/link";
import { useActionState } from "react";
import { btn, label, muted, staffBtn, staffField } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { Slip } from "@/app/ui/slip";
import { TooManyTries } from "../too-many-tries";
import { requestLoginLinkAction, type LoginFormState } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import type { LoginWay } from "@/lib/portal/login-way";

// The words follow how the link goes (P2.7; docs/screens.md `/login`): by text, by
// email, or not at all yet ("off": no form, so no one waits for a link that can't come).
// Phase 28.12: the notices are slips and the field's problems are said in red with their mark, as
// everywhere in the casual app (28.1's parts). Its "contact the office" lines stay: someone logged
// out can't use Messages.
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
      <Slip
        tone="attention"
        role="note"
        title="Login links aren't switched on yet."
        className="mt-6"
      >
        <p>Please contact the office the way you usually do.</p>
        <p className="text-ink-muted">{signOff}</p>
      </Slip>
    );
  }

  if (state.status === "sent") return <LinkSent firmName={firmName} signOff={signOff} way={way} />;

  return (
    <form action={action} className="mt-6">
      <label htmlFor="mobile" className={label}>
        Your mobile number
      </label>
      <p id="mobile-hint" className={`mt-1 ${muted}`}>
        The number {firmName} has for you, like 07700 900123
      </p>
      <input
        id="mobile"
        name="mobile"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        aria-invalid={state.status === "invalid_number"}
        aria-describedby={
          state.status === "invalid_number" ? "mobile-hint mobile-error" : "mobile-hint"
        }
        className={`${staffField} mt-2 tabular-nums aria-invalid:border-urgent`}
      />
      {state.status === "rate_limited" && <TooManyTries minutes={state.retryAfterMinutes} />}
      {state.status === "error" && (
        <p role="alert" className={problemLine}>
          <Icon name="urgent" size={18} />
          {tryAgainText()}
        </p>
      )}
      {state.status === "invalid_number" && (
        <p id="mobile-error" className={problemLine}>
          <Icon name="urgent" size={18} />
          Enter a UK mobile number, like 07700 900123.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${staffBtn.primary} mt-4`}>
        {pending ? "Sending…" : way === "email" ? "Email me a link" : "Send me a link"}
      </button>
    </form>
  );
}

// A problem under the field: red words with the warning mark (as the cancel sheet's, 28.1).
const problemLine = "mt-2 flex items-center gap-1.5 font-semibold text-urgent-ink";

// The answer once a link is asked for, the same whether or not the number is known (exported for
// the tests: the form only shows it after a real request). A green slip, signed by the firm.
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
    <Slip
      tone="done"
      role="status"
      title={
        <span className="text-lg">
          {way === "email" ? "Check your email." : "Check your phone."}
        </span>
      }
      className="mt-6"
    >
      {way === "email" ? (
        <>
          <p>
            If {firmName} has this number and your email address, we&apos;ve emailed you a link. It
            works for 15 minutes.
          </p>
          <p>Not there in a few minutes? Look in your junk folder.</p>
        </>
      ) : (
        <>
          <p>
            If {firmName} has this number, we&apos;ve sent a link by text. It works for 15 minutes.
          </p>
          <p>No text after 2 minutes? Check the number and try again, or contact the office.</p>
          {/* Phase 26.9: no text goes after STOP, and this page can't say whose number it is. */}
          <p>
            Replied STOP to our texts? Text START to the number you got them from, then ask again.
          </p>
        </>
      )}
      <p className="text-ink-muted">{signOff}</p>
      <Link href="/login" className={`${btn.link} self-start`}>
        Use a different number
      </Link>
    </Slip>
  );
}
