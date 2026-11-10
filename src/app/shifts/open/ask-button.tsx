"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { AskShiftOutcome } from "@/lib/portal/ask-shift";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { staffBtn } from "../../ui/classes";
import { askShiftAction } from "./actions";
import { AskResult } from "./ask-result";

type Shown = Exclude<AskShiftOutcome, { status: "logged_out" } | { status: "take_it" }>;

// "I can do this" (Phase 26.6, ses-6): one tap asks (the server decides), then the answer shows in
// place of the button: "Asked: we'll tell you", or why not. If the office has stopped choosing for
// it (or she now holds an offer), the page reloads with "Take shift".
export function AskButton({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const ask = () => {
    if (sending.current) return;
    sending.current = true;
    startTransition(async () => {
      const result = await askShiftAction(shiftId).catch(() => ({ status: "error" as const }));
      sending.current = false;
      if (result.status === "logged_out") router.replace(LOGIN_AGAIN);
      else if (result.status === "take_it") router.refresh();
      else setOutcome(result);
    });
  };

  if (outcome) {
    return (
      <div>
        <AskResult outcome={outcome} />
        {outcome.status === "error" && (
          <button
            type="button"
            disabled={pending}
            onClick={ask}
            className={`${staffBtn.secondary} mt-3`}
          >
            Try again
          </button>
        )}
        {(outcome.status === "filled" || outcome.status === "gone") && (
          <Link href="/shifts/open" className={`${staffBtn.primary} mt-3`}>
            See open shifts
          </Link>
        )}
      </div>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={ask} className={staffBtn.primary}>
      {pending ? "Asking…" : "I can do this"}
    </button>
  );
}
