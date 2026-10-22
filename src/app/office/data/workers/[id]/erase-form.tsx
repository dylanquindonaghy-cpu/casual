"use client";

import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { eraseResultText } from "@/lib/office/data-copy";
import { eraseWorkerAction } from "./actions";

const failed = { status: "error" as const };

// "I understand this can't be undone", then "Delete {name}'s personal details". The server checks
// everything again. The confirmation stays in place of the form once it's done. The tick box sits
// in its own red-tinted strip, and the button is solid red: this can't be undone.
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
    <div className="mt-6 flex flex-col items-start gap-4">
      {!done && (
        <>
          <label className="flex min-h-11 w-full items-center gap-3 rounded-row bg-urgent-soft px-3 py-2 font-semibold text-urgent-ink">
            <input
              type="checkbox"
              className="h-6 w-6 shrink-0 accent-urgent"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              disabled={!ready}
            />
            I understand this can&rsquo;t be undone
          </label>
          <button
            type="button"
            className={btn.dangerSolid}
            disabled={pending || !ready}
            onClick={erase}
          >
            Delete {name}&rsquo;s personal details
          </button>
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
