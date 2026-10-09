"use client";

import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { offerResultText } from "@/lib/office/today-copy";
import { resultBox } from "../../shifts/shift-tones";
import { offerShiftAction } from "../../today-actions";

// "Send offer" to one worker; the answer shows in place. One per row, so a plain (secondary)
// button.
export function OfferButton({
  shiftId,
  workerId,
  name,
}: {
  shiftId: string;
  workerId: string;
  name: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const send = () =>
    startTransition(async () => {
      const result = await offerShiftAction(shiftId, workerId).catch(() => ({
        status: "error" as const,
      }));
      setMessage(offerResultText(result, name));
      if (["queued", "already_offered", "failed_before"].includes(result.status)) setSent(true);
    });
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      {!sent && (
        <button
          type="button"
          disabled={pending}
          onClick={send}
          aria-label={`Send offer to ${name}`}
          className={btn.secondary}
        >
          Send offer
        </button>
      )}
      {message && (
        <p role="status" className={resultBox}>
          {message}
        </p>
      )}
    </div>
  );
}
