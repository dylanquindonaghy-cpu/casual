"use client";

import { useState, useTransition } from "react";
import { offerResultText } from "@/lib/office/today-copy";
import { offerShiftAction } from "../../today-actions";

// "Send offer" to one worker; the answer shows in place.
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
    <div>
      {!sent && (
        <button
          type="button"
          disabled={pending}
          onClick={send}
          aria-label={`Send offer to ${name}`}
          className="rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60"
        >
          Send offer
        </button>
      )}
      {message && (
        <p role="status" className="mt-1 font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
