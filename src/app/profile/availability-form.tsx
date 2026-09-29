"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { AvailabilityOutcome } from "@/lib/portal/profile-kinds";
import { dayLabel } from "@/lib/rules/reasons";
import { setUnavailableAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

// Days I can't work: pick a day → "Mark as unavailable"; each marked day has "Remove". The list
// reloads after each change; the answer shows above it.
export function AvailabilityForm({
  days,
  min,
  max,
  signOff,
}: {
  days: { day: string; booked: boolean }[];
  signOff: string;
  min: string;
  max: string;
}) {
  const router = useRouter();
  const [day, setDay] = useState("");
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const change = (target: string, on: boolean) => {
    if (sending.current) return;
    if (!target) return setMessage({ text: "Choose a day.", alert: true });
    sending.current = true;
    startTransition(async () => {
      const result: AvailabilityOutcome = await setUnavailableAction(target, on).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") return router.replace("/login");
      setMessage(say(result));
      if (result.status === "added" || result.status === "removed") {
        setDay("");
        router.refresh();
      }
    });
  };

  return (
    <div className="mt-3">
      <label className="block">
        <span className="font-semibold">A day you can&apos;t work</span>
        <input
          type="date"
          value={day}
          min={min}
          max={max}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 block w-full rounded-lg border-2 border-slate-300 px-3 py-3"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => change(day, true)}
        className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        Mark as unavailable
      </button>
      {message && (
        <div
          role={message.alert ? "alert" : "status"}
          className={`mt-3 ${message.alert ? "text-red-700" : ""}`}
        >
          <p>{message.text}</p>
          {!message.alert && <p className="mt-1 text-base">— {signOff}</p>}
        </div>
      )}
      {days.length === 0 ? (
        <p className="mt-4 text-base text-slate-600">No days marked.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {days.map((d) => (
            <li key={d.day} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-semibold">{dayLabel(d.day)}</span>
                {d.booked && (
                  <span className="block text-base text-slate-600">
                    You&apos;re booked that day. Marking it doesn&apos;t cancel that shift.
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => change(d.day, false)}
                aria-label={`Remove ${dayLabel(d.day)}`}
                className="min-h-12 rounded-xl border-2 border-slate-900 px-4 font-semibold disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The answer in plain words (exported for the tests).
export function say(result: Exclude<AvailabilityOutcome, { status: "logged_out" }>): {
  text: string;
  alert: boolean;
} {
  switch (result.status) {
    case "added":
      return {
        text: result.bookedThatDay
          ? `Marked ${dayLabel(result.day)} as unavailable. You're booked that day: marking it doesn't cancel that shift. Cancel it on My shifts if you can't work it.`
          : `Marked ${dayLabel(result.day)} as unavailable.`,
        alert: false,
      };
    case "removed":
      return { text: `${dayLabel(result.day)} is available again.`, alert: false };
    case "already":
      return { text: "That day is already marked.", alert: false };
    case "not_marked":
      return { text: "That day wasn't marked.", alert: false };
    case "past":
      return { text: "Choose today or a day after it.", alert: true };
    case "too_far":
      return { text: "Choose a day in the next 6 months.", alert: true };
    case "too_many":
      return { text: "You can mark up to 60 days. Remove one first.", alert: true };
    case "invalid":
      return { text: "Choose a day.", alert: true };
    case "error":
      return { text: tryAgainText(), alert: true };
  }
}
