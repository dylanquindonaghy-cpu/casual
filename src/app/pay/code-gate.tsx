"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, card, label, staffBtn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { TooManyTries } from "../too-many-tries";
import { requestCodeAction, verifyCodeAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

type Notice =
  | { kind: "none" }
  | { kind: "wrong"; attemptsLeft: number }
  | { kind: "invalid" }
  | { kind: "stopped" }
  | { kind: "wait"; minutes: number }
  | { kind: "error" };

// The code field: the staff field made bigger, with spaced-out digits that line up. Red edge
// while the code isn't right.
const codeField =
  "mt-2 min-h-14 w-full rounded-xl border-2 border-line-strong bg-white px-4 py-3 text-2xl font-normal tracking-widest text-ink tabular-nums aria-invalid:border-urgent";

// "To see your pay, we'll send you a 6-digit code." Plain words throughout (no "OTP").
// codeWaiting: a code sent earlier still works, so the code field shows straight away (a reload
// or a dropped tab mustn't make the worker ask again and retire the code they just received).
export function CodeGate({ codeWaiting }: { codeWaiting: boolean }) {
  const router = useRouter();
  const [hasCode, setHasCode] = useState(codeWaiting);
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  // The code field and the buttons wait for the page (docs/ui-design.md "Forms wait for the page").
  const ready = useHydrated();

  const sendCode = () =>
    startTransition(async () => {
      setNotice({ kind: "none" });
      const result = await requestCodeAction().catch(() => ({ status: "error" as const }));
      if (result.status === "sent") {
        setCode("");
        setHasCode(true);
      } else if (result.status === "rate_limited") {
        setNotice({ kind: "wait", minutes: result.retryAfterMinutes });
      } else if (result.status === "logged_out") router.replace("/login");
      else setNotice({ kind: "error" });
    });

  const checkCode = () =>
    startTransition(async () => {
      setNotice({ kind: "none" });
      const result = await verifyCodeAction(code).catch(() => ({ status: "error" as const }));
      if (result.status === "ok") router.refresh();
      else if (result.status === "wrong")
        setNotice({ kind: "wrong", attemptsLeft: result.attemptsLeft });
      else if (result.status === "invalid_code") setNotice({ kind: "invalid" });
      else if (result.status === "expired") {
        setHasCode(false);
        setNotice({ kind: "stopped" });
      } else if (result.status === "logged_out") router.replace("/login");
      else setNotice({ kind: "error" });
    });

  const alerts = (
    <>
      {notice.kind === "wait" && <TooManyTries minutes={notice.minutes} />}
      {notice.kind === "error" && (
        <p role="alert" className="mt-3 font-semibold text-urgent">
          {tryAgainText()}
        </p>
      )}
    </>
  );

  if (!hasCode) {
    return (
      <div className={card}>
        {notice.kind === "stopped" ? (
          <p role="alert" className="font-semibold text-urgent">
            This code has stopped working.
          </p>
        ) : (
          <p>To see your pay, we&apos;ll send you a 6-digit code.</p>
        )}
        {alerts}
        <button
          type="button"
          disabled={pending || !ready}
          onClick={sendCode}
          className={`${staffBtn.primary} mt-4`}
        >
          {pending
            ? "Sending…"
            : notice.kind === "stopped"
              ? "Send me a new code"
              : "Send me a code"}
        </button>
      </div>
    );
  }

  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        checkCode();
      }}
    >
      <p>We&apos;ve sent a 6-digit code by WhatsApp. It works for 10 minutes.</p>
      <label htmlFor="code" className={`${label} mt-4`}>
        Your code
      </label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-invalid={notice.kind === "wrong" || notice.kind === "invalid"}
        className={codeField}
        disabled={!ready}
      />
      {notice.kind === "wrong" && (
        <p role="alert" className="mt-2 font-semibold text-urgent">
          That code isn&apos;t right. You have {notice.attemptsLeft}{" "}
          {notice.attemptsLeft === 1 ? "try" : "tries"} left.
        </p>
      )}
      {notice.kind === "invalid" && (
        <p role="alert" className="mt-2 font-semibold text-urgent">
          Enter the 6-digit code from your message.
        </p>
      )}
      {alerts}
      <button type="submit" disabled={pending || !ready} className={`${staffBtn.primary} mt-4`}>
        {pending ? "Checking…" : "Check code"}
      </button>
      <button
        type="button"
        disabled={pending || !ready}
        onClick={sendCode}
        className={`${btn.link} mt-2 w-full justify-center`}
      >
        Send me a new code
      </button>
    </form>
  );
}
