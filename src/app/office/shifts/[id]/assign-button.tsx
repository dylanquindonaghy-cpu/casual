"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import { assignResultText } from "@/lib/office/shifts-copy";
import type { OverridableCode } from "@/lib/rules/eligibility";
import { useHydrated } from "@/app/use-hydrated";
import { resultBox } from "../shift-tones";
import { assignAction } from "../actions";

// "Assign {name}", or "Assign anyway" with a reason when the only "no"s are ones the office may
// override. The server checks everything again.
export function AssignButton({
  shiftId,
  workerId,
  name,
  overrides,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  overrides: OverridableCode[] | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const assign = () =>
    startTransition(async () => {
      if (overrides && !reason.trim()) {
        setMessage("Give a reason for the override.");
        return;
      }
      const result = await assignAction({
        shiftId,
        workerId,
        override: overrides ? { codes: overrides, reason: reason.trim() } : null,
      }).catch(() => ({ status: "error" as const }));
      setMessage(assignResultText(result, name));
      if (result.status === "booked") {
        setDone(true);
        router.refresh();
      }
    });
  return (
    <div className="mt-4 flex flex-col gap-3">
      {overrides && !done && (
        <label className={labelStack}>
          <span>Why is it all right? (kept with the booking)</span>
          <textarea
            className={`${field} w-full`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!ready}
          />
        </label>
      )}
      {!done && (
        <button
          type="button"
          className={`${btn.primary} self-start`}
          disabled={pending || !ready}
          onClick={assign}
        >
          {overrides ? "Assign anyway" : `Assign ${name}`}
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
