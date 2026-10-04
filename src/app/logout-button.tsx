"use client";

import { useState, useTransition } from "react";
import { clearOfflineCopy } from "@/lib/portal/offline";
import {
  logOut,
  logOutOfThisPhone,
  logoutProblemText,
  type LogoutOutcome,
} from "@/lib/portal/logout-client";
import { forgetThisPhonesPush } from "@/lib/portal/push-client";

// Logs out (worker or office user), then the browser goes to `after` itself. Through a plain
// route, not a server action, so a page kept from an earlier build can still log out (audit L92).
// With no signal it says so, and that they may still be logged in (audit L91).
export function LogoutButton({ kind, after }: { kind: "worker" | "office"; after: string }) {
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<{
    outcome: Exclude<LogoutOutcome, "done">;
    copyCleared: boolean;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setProblem(null);
            const { outcome, copyCleared } = await logOutOfThisPhone(kind, {
              clearCopy: clearOfflineCopy,
              forgetPush: forgetThisPhonesPush,
              logOut,
            });
            if (outcome !== "done") {
              setProblem({ outcome, copyCleared });
              return;
            }
            window.location.replace(after);
            // Stays "Logging out…" while the login page loads.
            await new Promise(() => undefined);
          })
        }
        className="mt-8 w-full rounded-xl border-2 border-slate-900 px-4 py-4 text-lg font-semibold disabled:opacity-60"
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {problem ? (
        <p role="alert" className="mt-3 text-lg font-semibold text-red-700">
          {logoutProblemText(kind, problem.outcome, problem.copyCleared)}
        </p>
      ) : null}
    </>
  );
}
