"use client";

import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { answerResultText } from "@/lib/office/requests-copy";
import { answerRequestAction } from "./actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const failed = { status: "error" as const };

// "Note to {name}", then "Approve and tell {name}" / "Decline and tell {name}". The server checks
// everything again. Once answered, the confirmation stays in place of the buttons (the page isn't
// refreshed under it); reloading moves the request to "Answered".
export function AnswerForm({ requestId, firstName }: { requestId: string; firstName: string }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const answer = (decision: "approved" | "declined") =>
    startTransition(async () => {
      if (decision === "declined" && !note.trim()) {
        setMessage("Add a note saying why.");
        return;
      }
      const result = await answerRequestAction({ requestId, decision, note }).catch(() => failed);
      setMessage(answerResultText(result, firstName));
      if (result.status === "resolved" || result.status === "already") setDone(true);
    });
  const id = `note-${requestId}`;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {!done && (
        <>
          <label htmlFor={id} className="font-semibold">
            Note to {firstName} (needed to decline)
          </label>
          <textarea
            id={id}
            className="rounded border border-slate-400 px-2 py-1"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={pending || !ready}
              onClick={() => answer("approved")}
            >
              Approve and tell {firstName}
            </button>
            <button
              type="button"
              className={button}
              disabled={pending || !ready}
              onClick={() => answer("declined")}
            >
              Decline and tell {firstName}
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
