"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeResultText, urgentResultText } from "@/lib/office/today-copy";
import { btn, checkStep } from "../ui/classes";
import { Icon } from "../ui/icons";
import { summaryButton } from "./shifts/[id]/chevron";
import { closeShiftAction, reopenShiftAction, setUrgentAction } from "./today-actions";

// The dashboard's "…" for the session in its detail card (Phase 24, 24.3; the urgent places' "…"
// since Phase 20): "Mark as filled", after a second click and with "Open it again" after it (not
// a Google Sheet's or the firm's planner's session, whose places are changed there), and "Not
// urgent" (or "Mark urgent"). A round button at the card's top right whose menu floats down from it
// over the card (the office's overlay glass),
// named for the session ("More for Tuesday's door supervisor at 08:00"). The answers show in
// `onMessage` (the detail card's line), and the page reloads its data once a change is made.
export function ShiftActions({
  shiftId,
  isUrgent,
  fromSheet,
  fromPlanner,
  more,
  onMessage,
}: {
  shiftId: string;
  isUrgent: boolean;
  fromSheet: boolean;
  fromPlanner: boolean;
  more: string;
  onMessage: (message: string) => void;
}) {
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  const [pending, startTransition] = useTransition();
  const failed = { status: "error" as const };

  const toggleUrgent = () =>
    startTransition(async () => {
      const result = await setUrgentAction(shiftId, !isUrgent).catch(() => failed);
      onMessage(urgentResultText(result));
      if (["marked", "marked_hidden", "cleared"].includes(result.status)) router.refresh();
    });
  const markFilled = () =>
    startTransition(async () => {
      const result = await closeShiftAction(shiftId).catch(() => failed);
      onMessage(closeResultText(result));
      if (result.status === "closed") setClosed(true);
    });
  const openAgain = () =>
    startTransition(async () => {
      const result = await reopenShiftAction(shiftId).catch(() => failed);
      onMessage(closeResultText(result));
      if (result.status === "reopened") {
        setClosed(false);
        router.refresh();
      }
    });

  if (closed)
    return (
      <button
        type="button"
        className={`${btn.secondary} shrink-0`}
        disabled={pending}
        onClick={openAgain}
      >
        Open it again
      </button>
    );
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label={more}
        className={`${summaryButton} press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press group-open:bg-button-press group-open:text-ink`}
      >
        <Icon name="dots" />
      </summary>
      <div className="absolute top-full right-0 z-10 mt-2 flex w-64 max-w-[80vw] origin-top-right animate-pop flex-col items-stretch gap-2 rounded-inner glass-float p-3">
        {!fromSheet && !fromPlanner && (
          <details className="group/filled">
            <summary
              className={`${btn.secondary} ${summaryButton} w-full group-open/filled:bg-button-press`}
            >
              Mark as filled
            </summary>
            <div className={`mt-2 animate-in ${checkStep}`}>
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
        <button type="button" className={btn.secondary} disabled={pending} onClick={toggleUrgent}>
          {isUrgent ? "Not urgent" : "Mark urgent"}
        </button>
      </div>
    </details>
  );
}
