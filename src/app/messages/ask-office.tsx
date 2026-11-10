"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { staffBtnInline } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { useOnline } from "@/app/use-online";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import {
  ASK_OFFICE_BUTTON,
  ASK_OFFICE_SENT,
  sendProblemText,
  type SendProblem,
} from "@/lib/portal/messages-copy";
import { sendAppMessageAction } from "./actions";

// "Not what you needed? Ask the office" (Phase 35.4; docs/screens.md "## Phase 35"), under the
// latest of the firm's own answers in her thread: one tap sends `words` (the page chose them:
// src/lib/portal/messages.ts askOfficeWords(), words the shifts line gives a person, naming the
// answer where it can) as her message, through Messages' own Send (its checks and its limit), then
// says "Sent to the office. They'll answer here." The page, read again, keeps saying it (`asked`).
// Waits for the page (docs/ui-design.md "Forms wait for the page").
export function AskOffice({ words, asked }: { words: string; asked: boolean }) {
  const router = useRouter();
  const ready = useHydrated();
  const online = useOnline();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  // This message's own id, kept for a second tap after a send that seemed to fail.
  const clientId = useRef<string | undefined>(undefined);
  if (asked || sent) {
    return (
      <p role="status" className="font-semibold" data-ask-office="sent">
        {ASK_OFFICE_SENT}
      </p>
    );
  }
  const ask = () =>
    startTransition(async () => {
      setProblem(null);
      clientId.current ??=
        typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
      const result = await sendAppMessageAction(words, clientId.current).catch(() => ({
        status: "error" as const,
      }));
      if (result.status === "logged_out") return router.replace(LOGIN_AGAIN);
      if (result.status !== "sent") {
        return setProblem(result.status === "rate_limited" ? "rate_limited" : "error");
      }
      setSent(true);
      router.refresh();
    });
  return (
    <div className="flex flex-col items-start gap-2" data-ask-office="ask">
      <button type="button" className={staffBtnInline} disabled={pending || !ready} onClick={ask}>
        {pending ? "Sending…" : ASK_OFFICE_BUTTON}
      </button>
      {problem && (
        <p role="alert" className="font-semibold text-urgent">
          {sendProblemText(problem, online)}
        </p>
      )}
    </div>
  );
}
