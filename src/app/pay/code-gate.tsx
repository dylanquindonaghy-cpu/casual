"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, label, staffBtn, staffCard } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { waitText } from "../too-many-tries";
import { requestCodeAction, verifyCodeAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import type { LoginWay } from "@/lib/portal/login-way";
import { MESSAGE_OFFICE, NO_CODE_SENDER, PAY_CODE } from "@/lib/portal/pay-copy";
import { isPayQueryPath } from "@/lib/portal/pay-query-kinds";

type Notice =
  | { kind: "none" }
  | { kind: "wrong"; attemptsLeft: number }
  | { kind: "invalid" }
  | { kind: "stopped" }
  | { kind: "wait"; minutes: number }
  | { kind: "error" };

// The code field: the staff field made bigger, with spaced-out digits that line up, 8px round as
// every field (Phase 28). Red edge while the code isn't right.
const codeField =
  "mt-2 min-h-14 w-full glass-tile rounded-row border-2 border-transparent px-4 py-3 text-2xl font-normal tracking-widest text-ink tabular-nums hover:border-line-strong aria-invalid:border-urgent";

// "To keep your pay private, we'll text you a 6‑digit code." Plain words throughout (no "OTP"), with
// "6‑digit" never split across two lines (src/lib/portal/pay-copy.ts). The words follow how the
// code goes (P2.7; docs/screens.md `/pay`): by text, by email, or not at all yet ("off": no code
// button, so no one waits for a code that can't come, and "Message the office" instead of a dead
// end, Phase 28.10).
// codeWaiting: a code sent earlier still works, so the code field shows straight away (a reload
// or a dropped tab mustn't make the worker ask again and retire the code they just received).
// purpose: the pay page's, or the pay query's (Phase 28.10: the step on the query itself, which
// comes back to `returnTo` once the code is right, keeping the shift she came for).
export function CodeGate({
  codeWaiting,
  way,
  purpose = "pay",
  returnTo,
  className,
}: {
  codeWaiting: boolean;
  way: LoginWay;
  purpose?: "pay" | "query";
  returnTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [hasCode, setHasCode] = useState(codeWaiting);
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  // The code field and the buttons wait for the page (docs/ui-design.md "Forms wait for the page").
  const ready = useHydrated();
  const box = (base: string) => (className ? `${base} ${className}` : base);

  // A right code: back to the pay query (its address cleaned of anything else), or this page again.
  // Only a path the page worked out (payQueryPath) and that is one (isPayQueryPath), never anything
  // read from the address.
  const opened = () => {
    const back = returnTo && isPayQueryPath(returnTo) ? returnTo : null;
    const here = `${window.location.pathname}${window.location.search}`;
    if (back && back !== here) router.replace(back);
    else router.refresh();
  };

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
      if (result.status === "ok") opened();
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
      {notice.kind === "wait" && (
        <Slip tone="urgent" role="alert" className="mt-4">
          <p className="font-semibold">Too many tries. Try again in {waitText(notice.minutes)}.</p>
        </Slip>
      )}
      {notice.kind === "error" && (
        <Slip tone="urgent" role="alert" className="mt-4">
          <p className="font-semibold">{tryAgainText()}</p>
        </Slip>
      )}
    </>
  );

  // Nothing can be sent, so no code step either: one sent before the firm switched email off
  // would be waiting under words that name a way it didn't come. Messages is the way on.
  if (way === "off") {
    const words = NO_CODE_SENDER[purpose];
    return (
      <div className={className}>
        <Slip tone="attention" role="note" title={words.title}>
          <p>{words.body}</p>
        </Slip>
        <Link href={MESSAGE_OFFICE.href} className={`${staffBtn.secondary} mt-4`}>
          {MESSAGE_OFFICE.label}
        </Link>
      </div>
    );
  }

  if (!hasCode) {
    return (
      <div className={box(staffCard)}>
        {notice.kind === "stopped" ? (
          <Slip tone="urgent" role="alert">
            <p className="font-semibold">{PAY_CODE.stopped}</p>
          </Slip>
        ) : (
          <p>{PAY_CODE.ask(way)}</p>
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
              ? PAY_CODE.sendNew(way)
              : PAY_CODE.send(way)}
        </button>
      </div>
    );
  }

  return (
    <form
      className={box(staffCard)}
      onSubmit={(e) => {
        e.preventDefault();
        checkCode();
      }}
    >
      <p>{PAY_CODE.sent(way)}</p>
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
          {PAY_CODE.notSixDigits(way)}
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
        {PAY_CODE.sendNew(way)}
      </button>
    </form>
  );
}
