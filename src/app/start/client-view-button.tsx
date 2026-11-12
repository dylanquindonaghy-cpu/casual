"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Slip } from "@/app/ui/slip";
import { CHOOSER_COPY } from "@/lib/demo/start-copy";
import { openClientViewAction, type ClientViewState } from "./actions";

// "Client view" (Phase 36.5): logs this browser in as the demo's client login (the match day's
// Demo Stadium Ltd contact), then opens the client's pages at /client.
export function ClientViewButton({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ClientViewState>({ status: "idle" });
  const open = () =>
    start(async () => {
      const result = await openClientViewAction();
      setState(result);
      if (result.status === "ok") router.push(CHOOSER_COPY.client.href);
    });
  const problem = clientViewProblem(state);
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
          <span className="text-sm text-ink-muted">{CHOOSER_COPY.client.pending}</span>
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

export function clientViewProblem(state: ClientViewState): string | null {
  switch (state.status) {
    case "logged_out":
      return CHOOSER_COPY.client.loggedOut;
    case "no_client":
      return CHOOSER_COPY.client.noClient;
    case "off":
    case "error":
      return CHOOSER_COPY.client.problem;
    default:
      return null;
  }
}
