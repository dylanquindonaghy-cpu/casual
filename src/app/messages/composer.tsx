"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { labelStack, staffBtn, staffField, tag } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { useOnline } from "@/app/use-online";
import { APP_MESSAGE_MAX, appMessageText, charCount } from "@/lib/inbound/app-limits";
import {
  COMPOSER_LABEL,
  SENT_TO_OFFICE,
  SENT_TO_PAYROLL,
  SENT_WAITING,
  sendProblemText,
  type SendProblem,
} from "@/lib/portal/messages-copy";
import { sendAppMessageAction } from "./actions";

// Every few seconds for a minute after a send, the page looks again until the answer is there.
const LOOK_EVERY_MS = 3_000;
const LOOKS = 20;

// The shift Messages was opened about (Phase 28.6; the page checks it: src/app/messages/page.tsx):
// its id, sent with the message, the About line, and the ready sentence the box starts with.
// Opened about her pay with no shift (the guardrails review of 28.10; Phase 29.1): no id (`shiftId`
// null), and the message is sent about her pay (`aboutPay`): a pay query for payroll, never sorted.
export interface ComposerAbout {
  shiftId: string | null;
  line: string; // "About: Steward · Sat 7 Nov, 10:30"
  sentence: string; // "" for "other"
}

// "Your message" → "Send". Her message shows in the thread at once (the page is read again);
// then "Sent. The answer comes here." until an answer comes after it (`answered`, from the page).
// The box and the button wait for the page (docs/ui-design.md "Forms wait for the page").
// Opened about a shift (Phase 28.6): the About line sits above the box (screen readers hear it
// with the box), the box starts with the ready sentence, hers to change, and the page scrolls to
// it (the focus stays put). Sent, the address loses the shift, so the About line goes and her next
// message is about nothing in particular, and "Sent. The office will answer here." stays until an
// answer comes: a person answers it, never an automatic answer (src/lib/inbound/reply.ts). Which
// "Sent" words show comes from what the send kept: a shift that ended before she tapped Send isn't
// kept, the message is sorted as any other, and the words are "Sent. The answer comes here."
// About her pay (Phase 29.1): it went to payroll as a pay query, so "Sent. Payroll will look at
// it. You'll see the answer on your Pay page." stays, and the page doesn't look again for an answer
// here (none comes here: payroll answers on her Pay page).
export function Composer({
  answered,
  about = null,
}: {
  answered: boolean;
  about?: ComposerAbout | null;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const online = useOnline();
  const aboutId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [text, setText] = useState(about?.sentence ?? "");
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const [waiting, setWaiting] = useState(false);
  // The last message sent kept its shift (the server says, src/app/messages/actions.ts): a person
  // answers it.
  const [toOffice, setToOffice] = useState(false);
  // The last message sent went to payroll as a pay query (Phase 29.1).
  const [toPayroll, setToPayroll] = useState(false);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  // This message's own id, kept until it's sent, so a second tap after a send that seemed to fail
  // (weak signal) can't store it twice (src/lib/inbound/app.ts).
  const clientId = useRef<string | undefined>(undefined);
  const aboutShift = about?.shiftId ?? undefined;
  const aboutPay = about !== null && about.shiftId === null;

  // Opened about a shift or her pay: bring the box into view, past a long thread.
  useEffect(() => {
    if (aboutShift || aboutPay) form.current?.scrollIntoView({ block: "center" });
  }, [aboutShift, aboutPay]);

  // Look again until the answer is there, at most LOOKS times.
  useEffect(() => {
    if (!waiting || answered || toPayroll) return;
    let looks = 0;
    const timer = setInterval(() => {
      looks += 1;
      if (looks > LOOKS) return clearInterval(timer);
      router.refresh();
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, answered, toPayroll, router]);

  const send = () => {
    if (sending.current) return;
    const words = appMessageText(text);
    if (words === "") return setProblem("empty");
    if (charCount(words) > APP_MESSAGE_MAX) return setProblem("too_long");
    setProblem(null);
    sending.current = true;
    clientId.current ??= typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
    const shiftId = aboutShift;
    startTransition(async () => {
      const result = await sendAppMessageAction(
        words,
        clientId.current,
        shiftId,
        aboutPay || undefined,
      ).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") return router.replace("/login");
      if (result.status !== "sent") return setProblem(result.status);
      clientId.current = undefined;
      setText("");
      setToOffice(result.toOffice);
      setToPayroll(result.toPayroll);
      setWaiting(true);
      // About a shift or her pay: the address drops it (the page is read again either way).
      if (shiftId || aboutPay) router.replace("/messages", { scroll: false });
      else router.refresh();
    });
  };

  return (
    <form
      ref={form}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {about && (
        <p id={aboutId} className={tag} data-about-shift>
          {about.line}
        </p>
      )}
      <label className={labelStack}>
        <span>{COMPOSER_LABEL}</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Different words are a different message.
            clientId.current = undefined;
          }}
          disabled={!ready}
          rows={3}
          aria-describedby={about ? aboutId : undefined}
          className={staffField}
        />
      </label>
      {problem && (
        <p role="alert" className="font-semibold text-urgent">
          {sendProblemText(problem, online)}
        </p>
      )}
      {waiting && (toPayroll || !answered) && !problem && (
        <p role="status" className="font-semibold">
          {toPayroll ? SENT_TO_PAYROLL : toOffice ? SENT_TO_OFFICE : SENT_WAITING}
        </p>
      )}
      <button type="submit" disabled={pending || !ready} className={staffBtn.primary}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
