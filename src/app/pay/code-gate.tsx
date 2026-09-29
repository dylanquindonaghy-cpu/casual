"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

const button =
  "mt-4 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60";

// "To see your pay, we'll send you a 6-digit code." Plain words throughout (no "OTP").
// codeWaiting: a code sent earlier still works, so the code field shows straight away (a reload
// or a dropped tab mustn't make the worker ask again and retire the code they just received).
export function CodeGate({ codeWaiting }: { codeWaiting: boolean }) {
  const router = useRouter();
  const [hasCode, setHasCode] = useState(codeWaiting);
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

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
        <p role="alert" className="mt-2 text-red-700">
          {tryAgainText()}
        </p>
      )}
    </>
  );

  if (!hasCode) {
    return (
      <div className="mt-6">
        {notice.kind === "stopped" ? (
          <p role="alert" className="text-red-700">
            This code has stopped working.
          </p>
        ) : (
          <p>To see your pay, we&apos;ll send you a 6-digit code.</p>
        )}
        {alerts}
        <button type="button" disabled={pending} onClick={sendCode} className={button}>
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
      className="mt-6"
      onSubmit={(e) => {
        e.preventDefault();
        checkCode();
      }}
    >
      <p>We&apos;ve sent a 6-digit code by WhatsApp. It works for 10 minutes.</p>
      <label htmlFor="code" className="mt-4 block font-semibold">
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
        className="mt-2 w-full rounded-xl border-2 border-slate-400 px-4 py-3 text-2xl tracking-widest"
      />
      {notice.kind === "wrong" && (
        <p role="alert" className="mt-2 text-red-700">
          That code isn&apos;t right. You have {notice.attemptsLeft}{" "}
          {notice.attemptsLeft === 1 ? "try" : "tries"} left.
        </p>
      )}
      {notice.kind === "invalid" && (
        <p role="alert" className="mt-2 text-red-700">
          Enter the 6-digit code from your message.
        </p>
      )}
      {alerts}
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Checking…" : "Check code"}
      </button>
      <button type="button" disabled={pending} onClick={sendCode} className="mt-4 w-full underline">
        Send me a new code
      </button>
    </form>
  );
}
