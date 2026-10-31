"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { labelStack, staffBtn, staffField } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { useOnline } from "@/app/use-online";
import { APP_MESSAGE_MAX, appMessageText, charCount } from "@/lib/inbound/app-limits";
import {
  COMPOSER_LABEL,
  SENT_WAITING,
  sendProblemText,
  type SendProblem,
} from "@/lib/portal/messages-copy";
import { sendAppMessageAction } from "./actions";

// Every few seconds for a minute after a send, the page looks again until the answer is there.
const LOOK_EVERY_MS = 3_000;
const LOOKS = 20;

// "Write to the office" → "Send". Her message shows in the thread at once (the page is read again);
// then "Sent. The answer comes here." until an answer comes after it (`answered`, from the page).
// The box and the button wait for the page (docs/ui-design.md "Forms wait for the page").
export function Composer({ answered }: { answered: boolean }) {
  const router = useRouter();
  const ready = useHydrated();
  const online = useOnline();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  // This message's own id, kept until it's sent, so a second tap after a send that seemed to fail
  // (weak signal) can't store it twice (src/lib/inbound/app.ts).
  const clientId = useRef<string | undefined>(undefined);

  // Look again until the answer is there, at most LOOKS times.
  useEffect(() => {
    if (!waiting || answered) return;
    let looks = 0;
    const timer = setInterval(() => {
      looks += 1;
      if (looks > LOOKS) return clearInterval(timer);
      router.refresh();
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, answered, router]);

  const send = () => {
    if (sending.current) return;
    const words = appMessageText(text);
    if (words === "") return setProblem("empty");
    if (charCount(words) > APP_MESSAGE_MAX) return setProblem("too_long");
    setProblem(null);
    sending.current = true;
    clientId.current ??= typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
    startTransition(async () => {
      const result = await sendAppMessageAction(words, clientId.current).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") return router.replace("/login");
      if (result.status !== "sent") return setProblem(result.status);
      clientId.current = undefined;
      setText("");
      setWaiting(true);
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
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
          className={staffField}
        />
      </label>
      {problem && (
        <p role="alert" className="font-semibold text-urgent">
          {sendProblemText(problem, online)}
        </p>
      )}
      {waiting && !answered && !problem && (
        <p role="status" className="font-semibold">
          {SENT_WAITING}
        </p>
      )}
      <button type="submit" disabled={pending || !ready} className={staffBtn.primary}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
