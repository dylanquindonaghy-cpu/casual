"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { urgentResultText } from "@/lib/office/today-copy";
import { setUrgentAction } from "../today-actions";

const failed = { status: "error" as const };

// A session's "Urgent" switch on the rota board's open row (Phase 18): the dashboard's quick action
// (src/lib/roster/urgent.ts) as a switch, red when on, with its word beside it ("Urgent" or "No").
// The server checks the office user and logs the change; the page then reloads its data. The
// answer shows under it.
export function UrgentSwitch({
  shiftId,
  isUrgent,
  name,
  disabled = false,
}: {
  shiftId: string;
  isUrgent: boolean;
  name: string; // the session's name, unique on the page
  disabled?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const flip = () =>
    startTransition(async () => {
      const result = await setUrgentAction(shiftId, !isUrgent).catch(() => failed);
      setMessage(urgentResultText(result));
      if (["marked", "marked_hidden", "cleared"].includes(result.status)) router.refresh();
    });
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isUrgent}
        aria-label={`Urgent: ${name}`}
        disabled={disabled || pending || !ready}
        onClick={flip}
        className="press inline-flex min-h-11 items-center gap-2 pr-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-10 items-center rounded-full p-1 transition-colors ${isUrgent ? "bg-urgent-fill" : "bg-switch-off"}`}
        >
          <span
            className={`size-4 rounded-full border border-line bg-card transition-transform duration-150 ease-sd motion-reduce:transition-none ${isUrgent ? "translate-x-4" : "translate-x-0"}`}
          />
        </span>
        <span className={`text-sm font-semibold ${isUrgent ? "text-urgent" : "text-ink-muted"}`}>
          {isUrgent ? "Urgent" : "No"}
        </span>
      </button>
      {message && (
        <p role="status" className="max-w-56 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
