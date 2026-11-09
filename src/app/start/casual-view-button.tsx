"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Slip } from "@/app/ui/slip";
import { CHOOSER_COPY } from "@/lib/demo/start-copy";
import { openCasualViewAction, type CasualViewState } from "./actions";

// "Casual mobile view" (Phase 31.2): logs this browser in as the demo casual (Zoe), then opens her
// app: in the phone frame on a laptop, or the app itself on a phone (below 640px, where a frame
// would only be a smaller phone inside the phone).
export function CasualViewButton({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<CasualViewState>({ status: "idle" });
  const open = () =>
    start(async () => {
      const result = await openCasualViewAction();
      setState(result);
      if (result.status !== "ok") return;
      const phone = window.matchMedia("(max-width: 639px)").matches;
      router.push(phone ? "/" : "/start/phone");
    });
  const problem = casualViewProblem(state);
  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        aria-busy={pending}
        className={`${className} disabled:cursor-wait`}
      >
        {children}
        {pending ? (
          <span className="text-sm text-ink-muted">{CHOOSER_COPY.casual.pending}</span>
        ) : null}
      </button>
      {problem && (
        <Slip tone="urgent" role="alert" className="mt-3">
          <p className="font-semibold">{problem}</p>
        </Slip>
      )}
    </>
  );
}

export function casualViewProblem(state: CasualViewState): string | null {
  switch (state.status) {
    case "logged_out":
      return CHOOSER_COPY.casual.loggedOut;
    case "no_casual":
      return CHOOSER_COPY.casual.noCasual;
    case "off":
    case "error":
      return CHOOSER_COPY.casual.problem;
    default:
      return null;
  }
}
