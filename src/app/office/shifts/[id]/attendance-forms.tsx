"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { attendanceResultText, restWorkedResultText } from "@/lib/office/shifts-copy";
import { markAttendanceAction, markRestWorkedAction } from "../actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const failed = { status: "error" as const };

// Once the shift has started: "Mark as worked" / "Mark as didn't attend" for someone booked, or
// "Change to …" for someone already marked. The server checks everything again and logs it.
export function AttendanceButtons({
  shiftId,
  workerId,
  name,
  status,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  status: "confirmed" | "completed" | "no_show";
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const mark = (outcome: "completed" | "no_show") =>
    startTransition(async () => {
      const result = await markAttendanceAction(shiftId, workerId, outcome).catch(() => failed);
      setMessage(attendanceResultText(result, name));
      if (result.status === "marked") router.refresh();
    });
  const worked = status === "confirmed" ? "Mark as worked" : "Change to worked";
  const absent = status === "confirmed" ? "Mark as not attended" : "Change to not attended";
  return (
    <div className="mt-1 mb-2 flex flex-wrap items-center gap-2">
      {status !== "completed" && (
        <button
          type="button"
          className={button}
          disabled={pending || !ready}
          aria-label={`${worked}: ${name}`}
          onClick={() => mark("completed")}
        >
          {worked}
        </button>
      )}
      {status !== "no_show" && (
        <button
          type="button"
          className={button}
          disabled={pending || !ready}
          aria-label={`${absent}: ${name}`}
          onClick={() => mark("no_show")}
        >
          {absent}
        </button>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}

// After the end: everyone not marked yet is marked as worked, in one go, after a "Yes". Stays on
// the page once nobody is left, so the confirmation isn't lost when the page refreshes.
export function MarkRestWorked({ shiftId, count }: { shiftId: string; count: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const mark = () =>
    startTransition(async () => {
      const result = await markRestWorkedAction(shiftId).catch(() => failed);
      setMessage(restWorkedResultText(result));
      if (result.status === "marked") router.refresh();
    });
  const people = count === 1 ? "the 1 person" : `the ${count} people`;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {count > 0 && (
        <details className="rounded-lg border border-slate-300 px-3 py-2">
          <summary className="cursor-pointer font-semibold">
            Mark {people} not marked yet as worked
          </summary>
          <p className="mt-2">Only if they all worked it. You can change anyone afterwards.</p>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={pending || !ready}
            onClick={mark}
          >
            Yes, mark them as worked
          </button>
        </details>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
