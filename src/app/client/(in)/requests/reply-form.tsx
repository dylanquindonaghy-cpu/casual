"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, field, label } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { tooManyRequestsWords } from "@/lib/client/words";
import { replyToQuestionAction, type ReplyActionResult } from "../../actions";

// The reply box under the office's question (Phase 36.4: "Question for you"): their answer goes
// back to the office and the request waits for it again. Ends with a confirmation that stays: the
// page reloads with ?answered= and shows it on the request. Waits for the page to be ready.
export function ReplyForm({
  requestId,
  question,
  firmName,
  sentWords,
  problemWords,
}: {
  requestId: string;
  question: string;
  firmName: string;
  sentWords: string;
  problemWords: Record<Exclude<ReplyActionResult["status"], "sent" | "rate_limited">, string>;
}) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ReplyActionResult | null>(null);
  if (result?.status === "sent") {
    return (
      <Slip tone="done" role="status" title="Sent">
        <p>{sentWords}</p>
      </Slip>
    );
  }
  const problem = !result
    ? null
    : result.status === "rate_limited"
      ? tooManyRequestsWords(result.retryAfterMinutes)
      : problemWords[result.status as keyof typeof problemWords];
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await replyToQuestionAction(requestId, text).catch((): ReplyActionResult => ({
            status: "error",
          }));
          setResult(r);
          // The address names the request answered, so the page keeps its "Sent" once it has
          // refreshed and this reply box has gone (the request has no question any more).
          if (r.status === "sent") {
            router.replace(`/client/requests?answered=${encodeURIComponent(requestId)}`, {
              scroll: false,
            });
          }
        });
      }}
    >
      <Slip tone="attention" title={`${firmName} asks`}>
        <p className="break-words">&ldquo;{question}&rdquo;</p>
      </Slip>
      <label htmlFor={`${id}-reply`} className={label}>
        Your answer
      </label>
      <textarea
        disabled={!ready}
        id={`${id}-reply`}
        rows={3}
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={result?.status === "invalid"}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={`${field} w-full`}
      />
      {problem && (
        <p id={`${id}-problem`} role="alert" className="font-semibold text-urgent-ink">
          {problem}
        </p>
      )}
      <button type="submit" disabled={!ready || pending} className={`${btn.primary} self-start`}>
        {pending ? "Sending…" : "Send my answer"}
      </button>
    </form>
  );
}
