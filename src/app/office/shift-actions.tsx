"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeResultText, urgentResultText } from "@/lib/office/today-copy";
import { btn } from "../ui/classes";
import { Chevron, summaryButton } from "./shifts/[id]/chevron";
import { closeShiftAction, reopenShiftAction, setUrgentAction } from "./today-actions";

// The dashboard's quick actions for one shift: offer it to someone, mark it urgent (or not), mark it as
// filled (after a second click, with an undo). Results show in place. On an urgent shift
// "Offer to someone" is the main button; on a gap every button looks the same, so the urgent
// ones stand out.
export function ShiftActions({
  shiftId,
  isUrgent,
  fromSheet,
  className,
}: {
  shiftId: string;
  isUrgent: boolean;
  fromSheet: boolean;
  className?: string; // where it sits in its card or row
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [pending, startTransition] = useTransition();
  const failed = { status: "error" as const };

  const toggleUrgent = () =>
    startTransition(async () => {
      const result = await setUrgentAction(shiftId, !isUrgent).catch(() => failed);
      setMessage(urgentResultText(result));
      if (["marked", "marked_hidden", "cleared"].includes(result.status)) router.refresh();
    });
  const markFilled = () =>
    startTransition(async () => {
      const result = await closeShiftAction(shiftId).catch(() => failed);
      setMessage(closeResultText(result));
      if (result.status === "closed") setClosed(true);
    });
  const openAgain = () =>
    startTransition(async () => {
      const result = await reopenShiftAction(shiftId).catch(() => failed);
      setMessage(closeResultText(result));
      if (result.status === "reopened") {
        setClosed(false);
        router.refresh();
      }
    });

  return (
    <div className={className}>
      {closed ? (
        <button type="button" className={btn.secondary} disabled={pending} onClick={openAgain}>
          Open it again
        </button>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href={`/office/offer/${shiftId}`}
            className={isUrgent ? btn.primary : btn.secondary}
          >
            Offer to someone
          </Link>
          <button type="button" className={btn.secondary} disabled={pending} onClick={toggleUrgent}>
            {isUrgent ? "Not urgent" : "Mark urgent"}
          </button>
          {!fromSheet && (
            <details className="group">
              <summary className={`${btn.secondary} ${summaryButton} group-open:bg-quiet-soft`}>
                Mark as filled
                <Chevron />
              </summary>
              <div className="mt-2 w-64 max-w-full rounded-lg border border-line bg-card p-3 shadow-sm">
                <p className="text-sm">
                  Only if you&apos;ve filled it another way. Nobody else will be offered it.
                </p>
                <button
                  type="button"
                  className={`${btn.primary} mt-3`}
                  disabled={pending}
                  onClick={markFilled}
                >
                  Yes, mark as filled
                </button>
              </div>
            </details>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
