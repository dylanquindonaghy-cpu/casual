"use client";

import { useState, useTransition } from "react";
import { btn, field, label } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { answerResultText, approveWord } from "@/lib/office/requests-copy";
import { answerRequestAction } from "./actions";

const failed = { status: "error" as const };

// "Note to {name}", then "Approve and tell {name}" ("Answer and tell {name}" for a question: the
// main action) / "Decline and tell {name}".
// The server checks everything again. Once answered, the confirmation stays in place of the
// buttons (the page isn't refreshed under it); reloading moves the request to "Answered".
export function AnswerForm({
  requestId,
  firstName,
  type,
}: {
  requestId: string;
  firstName: string;
  type: string;
}) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Answered just now: the confirmation shows as done (green, with its words).
  const [answered, setAnswered] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const answer = (decision: "approved" | "declined") =>
    startTransition(async () => {
      if (decision === "declined" && !note.trim()) {
        setMessage("Add a note saying why.");
        return;
      }
      const result = await answerRequestAction({ requestId, decision, note }).catch(() => failed);
      setMessage(answerResultText(result, firstName, type));
      setAnswered(result.status === "resolved");
      if (result.status === "resolved" || result.status === "already") setDone(true);
    });
  const id = `note-${requestId}`;
  return (
    <div className="flex flex-col gap-2">
      {!done && (
        <>
          <label htmlFor={id} className={label}>
            Note to {firstName} (needed to decline)
          </label>
          <textarea
            id={id}
            className={`${field} w-full`}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!ready}
          />
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col">
            <button
              type="button"
              className={btn.primary}
              disabled={pending || !ready}
              onClick={() => answer("approved")}
            >
              {approveWord(type)} and tell {firstName}
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={pending || !ready}
              onClick={() => answer("declined")}
            >
              Decline and tell {firstName}
            </button>
          </div>
        </>
      )}
      {message && (
        <p
          role="status"
          className={
            answered
              ? "rounded-lg border border-done bg-done-soft px-3 py-2 font-semibold text-done-ink"
              : "font-semibold"
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
