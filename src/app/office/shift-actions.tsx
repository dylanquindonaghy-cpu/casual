"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeResultText, urgentResultText } from "@/lib/office/today-copy";
import { btn, checkStep } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Chevron, summaryButton } from "./shifts/[id]/chevron";
import { closeShiftAction, reopenShiftAction, setUrgentAction } from "./today-actions";

// The dashboard's quick actions for one shift: offer it to someone, mark it urgent (or not), mark it as
// filled (after a second click, with an undo; not a Google Sheet's or the firm's planner's, whose
// places are changed there). Results show in place. On an urgent shift
// "Offer to someone" is the main button; on a gap every button looks the same, so the urgent
// ones stand out.
// Phase 18 (the dashboard's urgent place): "Offer to someone" filled, "Mark as filled" outlined,
// "Not urgent" in words. Phase 20 (`more`, each urgent place on the dashboard): "Offer to someone",
// then "…" (named by `more`) opening "Mark as filled" and "Not urgent". `onMessage`: the answers go
// there (the dashboard's confirmation, which stays while the place leaves) instead of under the
// buttons. Phase 22: "Offer" dips when pressed and shows a spinner in place of its word while the
// offer page opens (`OfferWord`); the "…" menu grows out of its button. Phase 23 (round 3): on the
// urgent place's card, "Offer" is the wide sky main button (still named "Offer to someone") and
// "…" a round button with its hairline; the menu floats (the office's one overlay).
export function ShiftActions({
  shiftId,
  isUrgent,
  fromSheet,
  fromPlanner,
  className,
  onMessage,
  more,
}: {
  shiftId: string;
  isUrgent: boolean;
  fromSheet: boolean;
  fromPlanner: boolean;
  className?: string; // where it sits in its card or row
  onMessage?: (message: string) => void;
  more?: string; // the "…" button's name ("More for Thursday's door supervisor")
}) {
  const router = useRouter();
  const [shown, setShown] = useState<string | null>(null);
  const setMessage = (m: string) => (onMessage ? onMessage(m) : setShown(m));
  const message = onMessage ? null : shown;
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

  // "Mark as filled", after a second click; and "Not urgent" (or "Mark urgent").
  const filledStep = (
    <details className="group/filled">
      <summary className={`${btn.secondary} ${summaryButton} group-open/filled:bg-button-press`}>
        Mark as filled
        <Chevron />
      </summary>
      <div className={`mt-2 w-64 max-w-full animate-in ${checkStep}`}>
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
  );
  const notUrgent = (
    <button
      type="button"
      className={isUrgent ? btn.text : btn.secondary}
      disabled={pending}
      onClick={toggleUrgent}
    >
      {isUrgent ? "Not urgent" : "Mark urgent"}
    </button>
  );

  return (
    // The "…" menu hangs from this box: from its left edge while the buttons sit under the words
    // (on a phone), from its right edge from 768px, where they end the row (so it never runs off
    // the screen).
    <div className={`relative${className ? ` ${className}` : ""}`}>
      {closed ? (
        <button type="button" className={btn.secondary} disabled={pending} onClick={openAgain}>
          Open it again
        </button>
      ) : (
        <div className={more ? "flex items-center gap-2" : "flex flex-wrap items-start gap-2"}>
          {more ? (
            <Link
              href={`/office/offer/${shiftId}`}
              aria-label="Offer to someone"
              className={`${btn.primary} flex-1`}
            >
              <OfferWord />
            </Link>
          ) : (
            <Link
              href={`/office/offer/${shiftId}`}
              className={isUrgent ? btn.primary : btn.secondary}
            >
              Offer to someone
            </Link>
          )}
          {more ? (
            // The rest under "…": a menu over the page (Phase 20).
            <details className="group">
              <summary
                aria-label={more}
                className={`${summaryButton} press inline-flex size-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-raised hover:text-ink active:bg-button-press group-open:bg-raised group-open:text-ink`}
              >
                <Icon name="dots" />
              </summary>
              <div className="absolute top-full left-0 z-10 mt-2 flex w-64 max-w-[80vw] origin-top-left animate-pop flex-col items-stretch gap-2 rounded-inner bg-card p-3 shadow-float md:right-0 md:left-auto md:origin-top-right">
                {!fromSheet && !fromPlanner && filledStep}
                {notUrgent}
              </div>
            </details>
          ) : (
            <>
              {!fromSheet && !fromPlanner && filledStep}
              {notUrgent}
            </>
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

// "Offer" on the dashboard's pill: the word, or a spinner in its place while the offer page is on
// its way (the pill keeps its width).
function OfferWord() {
  const { pending } = useLinkStatus();
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className={pending ? "opacity-0" : undefined}>Offer</span>
      {pending && (
        <span
          aria-hidden="true"
          className="absolute size-4 animate-turn rounded-full border-2 border-current border-r-transparent"
        />
      )}
    </span>
  );
}
