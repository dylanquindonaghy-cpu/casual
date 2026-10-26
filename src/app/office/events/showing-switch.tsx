"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { showingResultText } from "@/lib/office/shifts-copy";
import { resultBox } from "../shifts/shift-tones";
import { setShowingAction } from "../shifts/actions";

const failed = { status: "error" as const };

// The event's or a session's "show to casuals" switch (docs/office-v2.md 3.3). A button with the
// switch role: its name says what it shows ("Show Raceday to casuals"), and it reads on or off.
// The server checks the office user and logs the change; the page then reloads its data. The
// answer stays beside it ("Hidden from casuals. Booked casuals keep their shifts."). Waits for the
// page (docs/ui-design.md "Forms wait for the page").
export function ShowingSwitch({
  target,
  id,
  showing,
  label,
  small,
  describedBy,
}: {
  target: "event" | "session";
  id: string;
  showing: boolean;
  label: string;
  small?: boolean;
  describedBy?: string; // the words beside it, when they say more than on or off
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const flip = () =>
    startTransition(async () => {
      const result = await setShowingAction({ target, id, showing: !showing }).catch(() => failed);
      setMessage(showingResultText(result, target));
      if (result.status === "shown" || result.status === "hidden") router.refresh();
    });
  // The track and its knob, 4px in from its edges (Phase 21's spacing); the knob solid (`knob`:
  // white in light, near-black in dark, where the on track is near-white ink) with a soft lift.
  const track = small ? "h-6 w-10" : "h-7 w-12";
  const knob = small ? "size-4" : "size-5";
  const on = small ? "translate-x-4" : "translate-x-5";
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={showing}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={pending || !ready}
        onClick={flip}
        className={`press relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span
          aria-hidden="true"
          className={`${track} inline-flex items-center rounded-full p-1 transition-colors ${showing ? "bg-ink" : "bg-switch-off"}`}
        >
          <span
            className={`${knob} rounded-full bg-knob shadow-lift transition-transform duration-150 ease-sd motion-reduce:transition-none ${showing ? on : "translate-x-0"}`}
          />
        </span>
      </button>
      {message && (
        <p role="status" className={`${resultBox} max-w-xs text-sm`}>
          {message}
        </p>
      )}
    </div>
  );
}
