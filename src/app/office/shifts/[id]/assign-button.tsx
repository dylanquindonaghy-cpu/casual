"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignResultText } from "@/lib/office/shifts-copy";
import type { OverridableCode } from "@/lib/rules/eligibility";
import { assignAction } from "../actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";

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
    <div className="mt-2 flex flex-col gap-2">
      {overrides && !done && (
        <label className="flex flex-col">
          <span className="font-semibold">Why is it all right? (goes in the log)</span>
          <textarea
            className="rounded border border-slate-400 px-2 py-1"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {!done && (
        <button type="button" className={button} disabled={pending} onClick={assign}>
          {overrides ? "Assign anyway" : `Assign ${name}`}
        </button>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
