"use client";

import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { eraseResultText } from "@/lib/office/data-copy";
import { eraseWorkerAction } from "./actions";

const button =
  "rounded-lg border border-red-700 px-3 py-2 font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60";
const failed = { status: "error" as const };

// "I understand this can't be undone", then "Delete {name}'s personal details". The server checks
// everything again. The confirmation stays in place of the form once it's done.
export function EraseForm({ workerId, name }: { workerId: string; name: string }) {
  const [understood, setUnderstood] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const erase = () =>
    startTransition(async () => {
      const result = await eraseWorkerAction({ workerId, understood }).catch(() => failed);
      setMessage(eraseResultText(result));
      if (result.status === "erased" || result.status === "already") setDone(true);
    });
  return (
    <div className="mt-4 flex flex-col gap-3">
      {!done && (
        <>
          <label className="flex items-center gap-3 font-semibold">
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            I understand this can&rsquo;t be undone
          </label>
          <div>
            <button type="button" className={button} disabled={pending || !ready} onClick={erase}>
              Delete {name}&rsquo;s personal details
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
