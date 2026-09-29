"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { TakeShiftOutcome } from "@/lib/portal/take-shift";
import { takeShiftAction } from "./actions";
import { ReviewForm } from "../[id]/review-form";
import { TakeShiftResult } from "./take-shift-result";

type Shown = Exclude<TakeShiftOutcome, { status: "logged_out" }>;

// "Take shift": one tap books it (the server decides), then the answer shows in place of the
// button. After "just filled" or "not open any more", the list can be refreshed. When the rules
// say no, the worker can ask the office to review: a link to the shift's page from the list, or the
// review form right there on the shift's page.
export function TakeShiftButton({
  shiftId,
  onShiftPage = false,
}: {
  shiftId: string;
  onShiftPage?: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  // A second tap before the first answer arrives sends nothing (it would only come back "already
  // booked" and hide the confirmation).
  const sending = useRef(false);

  const take = () => {
    if (sending.current) return;
    sending.current = true;
    startTransition(async () => {
      const result = await takeShiftAction(shiftId).catch(() => ({ status: "error" as const }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else setOutcome(result);
    });
  };

  if (outcome) {
    const retry = outcome.status === "error" || outcome.status === "try_again";
    const refresh =
      outcome.status === "filled" || outcome.status === "gone" || outcome.status === "not_yet";
    return (
      <div className="mt-3">
        <TakeShiftResult
          outcome={outcome}
          reviewHref={onShiftPage ? undefined : `/shifts/${shiftId}`}
        />
        {onShiftPage && outcome.status === "not_eligible" && <ReviewForm shiftId={shiftId} />}
        {(retry || refresh) && (
          <button
            type="button"
            disabled={pending}
            onClick={retry ? take : () => router.refresh()}
            className="mt-3 w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-lg font-semibold disabled:opacity-60"
          >
            {retry ? "Try again" : onShiftPage ? "Reload this shift" : "See other open shifts"}
          </button>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={take}
      className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Booking…" : "Take shift"}
    </button>
  );
}
