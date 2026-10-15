"use client";

import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { keepResultText } from "@/lib/office/today-copy";
import { btn } from "../ui/classes";
import { CancelBookingForm } from "./shifts/[id]/firm-change-forms";
import { keepBookingAction } from "./today-actions";

// The browser's request failed: the server may have kept it.
const failed = { status: "error" as const };

// the dashboard's "Bookings to check", one booking: "Cancel {name}'s booking" (the shift page's form, its
// reasons with "They've left, or can't work here") or "Keep the booking". The server checks
// everything again. Whichever is done, its confirmation stays in place and the other goes (no
// refresh: that would take the booking, and the confirmation with it, off the list); the list
// updates on the next visit.
export function BookingToCheckActions({
  shiftId,
  workerId,
  name,
}: {
  shiftId: string;
  workerId: string;
  name: string;
}) {
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"kept" | "cancelled" | null>(null);
  const keep = () =>
    startTransition(async () => {
      const result = await keepBookingAction(shiftId, workerId).catch(() => failed);
      setMessage(keepResultText(result, name));
      if (result.status === "kept" || result.status === "already") setOutcome("kept");
    });
  // The two choices side by side (they wrap on a phone). The cancel form opens downwards in
  // place, beside "Keep the booking".
  return (
    <div className="mt-4 flex flex-wrap items-start gap-3">
      {outcome !== "kept" && (
        <CancelBookingForm
          shiftId={shiftId}
          workerId={workerId}
          name={name}
          refreshOnDone={false}
          onDone={() => setOutcome("cancelled")}
        />
      )}
      {outcome === null && (
        <button type="button" className={btn.secondary} disabled={pending || !ready} onClick={keep}>
          Keep the booking
        </button>
      )}
      {message && (
        <p role="status" className="basis-full font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
