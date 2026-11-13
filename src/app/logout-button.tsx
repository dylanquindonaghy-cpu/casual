"use client";

import { type ReactNode, useState, useTransition } from "react";
import { clearOfflineCopy } from "@/lib/portal/offline";
import {
  logOut,
  logOutOfThisPhone,
  logoutProblemText,
  type LogoutKind,
  type LogoutOutcome,
} from "@/lib/portal/logout-client";
import { forgetThisPhonesPush } from "@/lib/portal/push-client";
import { forgetTourLater } from "@/lib/tour/steps";
import { useHydrated } from "./use-hydrated";

// Logs out (worker or office user), then the browser goes to `after` itself. Through a plain
// route, not a server action, so a page kept from an earlier build can still log out (audit L92).
// With no signal it says so, and that they may still be logged in (audit L91).
// Each caller gives the button its classes (`className`, from src/app/ui/classes.ts: My shifts'
// quieter button, the office shell's footer); `icon` goes before the words.
export function LogoutButton({
  kind,
  after,
  className,
  icon,
}: {
  kind: LogoutKind;
  after: string;
  className: string;
  icon?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  // Its work is a click handler: disabled until the page is ready (Phase 37.7).
  const ready = useHydrated();
  const [problem, setProblem] = useState<{
    outcome: Exclude<LogoutOutcome, "done">;
    copyCleared: boolean;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={!ready || pending}
        onClick={() =>
          startTransition(async () => {
            setProblem(null);
            const { outcome, copyCleared } = await logOutOfThisPhone(kind, {
              clearCopy: clearOfflineCopy,
              forgetPush: forgetThisPhonesPush,
              forgetTour: () => {
                try {
                  forgetTourLater(localStorage, sessionStorage);
                } catch {
                  // storage off
                }
              },
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
        className={className}
      >
        {icon}
        {pending ? "Logging out…" : "Log out"}
      </button>
      {problem ? (
        <p role="alert" className="mt-3 text-lg font-semibold text-urgent office:text-urgent-ink">
          {logoutProblemText(kind, problem.outcome, problem.copyCleared)}
        </p>
      ) : null}
    </>
  );
}
