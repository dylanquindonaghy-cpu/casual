"use client";

import { useId, useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { sortText } from "@/lib/office/pay-sort-copy";
import { sortPayQueriesAction } from "./sort-actions";

const button =
  "rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:opacity-60";
const failed = { status: "error" as const };

// Sorts the queries payroll sees in this group, with a note each person gets. Once sorted, the
// answer stays here (the group leaves the list when the page is next loaded), so the confirmation
// can't vanish on a refresh.
export function SortGroupForm({ ids }: { ids: string[] }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const fieldId = useId();
  const hintId = useId();
  const sort = () =>
    startTransition(async () => {
      const result = await sortPayQueriesAction(ids, note).catch(() => failed);
      setMessage(sortText(result));
      if (result.status === "sorted" || result.status === "already") setDone(true);
    });
  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      {!done && (
        <>
          <label htmlFor={fieldId} className="block font-semibold">
            Tell them what payroll did
          </label>
          <p id={hintId} className="text-base text-slate-600">
            Everyone in this group gets the same note, by message and on their pay page, so
            don&apos;t name anyone or give one person&apos;s figures. At most 500 characters.
            Don&apos;t include bank details.
          </p>
          <textarea
            id={fieldId}
            aria-describedby={hintId}
            className="mt-1 w-full rounded border border-slate-400 p-2"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={pending || !ready}
            onClick={sort}
          >
            Mark as sorted and tell them
          </button>
        </>
      )}
      {message && (
        <p role="status" className="mt-2 font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
