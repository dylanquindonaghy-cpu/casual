"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeResultText, urgentResultText } from "@/lib/office/today-copy";
import { closeShiftAction, reopenShiftAction, setUrgentAction } from "./today-actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";

// Today's quick actions for one shift: offer it to someone, mark it urgent (or not), mark it as
// filled (after a second click, with an undo). Results show in place.
export function ShiftActions({
  shiftId,
  isUrgent,
  fromSheet,
}: {
  shiftId: string;
  isUrgent: boolean;
  fromSheet: boolean;
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
      if (result.status === "marked" || result.status === "cleared") router.refresh();
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
    <div className="mt-3">
      {closed ? (
        <button type="button" className={button} disabled={pending} onClick={openAgain}>
          Open it again
        </button>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`/office/offer/${shiftId}`} className={button}>
            Offer to someone
          </Link>
          <button type="button" className={button} disabled={pending} onClick={toggleUrgent}>
            {isUrgent ? "Not urgent" : "Mark urgent"}
          </button>
          {!fromSheet && (
            <details className="rounded-lg border border-slate-300 px-3 py-2">
              <summary className="cursor-pointer font-semibold">Mark as filled</summary>
              <p className="mt-2">
                Only if you&apos;ve filled it another way. Nobody else will be offered it.
              </p>
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={pending}
                onClick={markFilled}
              >
                Yes, mark as filled
              </button>
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
