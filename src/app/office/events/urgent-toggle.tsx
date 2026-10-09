"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { urgentResultText } from "@/lib/office/today-copy";
import { resultBox } from "../shifts/shift-tones";
import { setUrgentAction } from "../today-actions";

const failed = { status: "error" as const };

// "Mark urgent" / "Not urgent" in a session's "…" menu: Today's quick action (src/lib/roster/urgent.ts).
export function UrgentToggle({
  shiftId,
  isUrgent,
  name,
}: {
  shiftId: string;
  isUrgent: boolean;
  name: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const toggle = () =>
    startTransition(async () => {
      const result = await setUrgentAction(shiftId, !isUrgent).catch(() => failed);
      setMessage(urgentResultText(result));
      if (["marked", "marked_hidden", "cleared"].includes(result.status)) router.refresh();
    });
  const words = isUrgent ? "Not urgent" : "Mark urgent";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={`${btn.secondary} justify-start`}
        aria-label={`${words}: ${name}`}
        disabled={pending || !ready}
        onClick={toggle}
      >
        {words}
      </button>
      {message && (
        <p role="status" className={`${resultBox} text-sm`}>
          {message}
        </p>
      )}
    </div>
  );
}
