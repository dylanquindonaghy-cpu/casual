"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import {
  saidComingText,
  STILL_COMING_ERROR,
  STILL_COMING_NOT_NOW,
  STILL_COMING_THANKS,
  STILL_COMING_TITLE,
  YES_COMING,
} from "@/lib/portal/still-coming-copy";
import { useHydrated } from "@/app/use-hydrated";
import { disc, staffBtn } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Slip } from "../ui/slip";
import { stillComingAction } from "./[id]/actions";

// "Still coming?" (Phase 28.14; docs/screens.md "The casual app, Phase 28" 28.14): the card on the
// pass and on the shift's page from 24 hours before her booked shift until it starts (the caller
// decides when, stillComingOpen()). Its heading, "Yes, I'm coming" (the shift page's main button,
// clear glass on the pass, where Directions is the main one) and `cancel`: the existing "Can't make
// it?" sheet (src/app/shifts/cancel-shift.tsx), its strike rules unchanged. After the tap a green
// slip "Thanks. The office can see you're coming." and the card reads "You said you're coming (Fri
// 13:02)", as it does whenever she opens it again. A second tap anywhere gets the same answer.
//
// `data-online-only` on the whole card: the copy kept for no signal (Home and Booked) never shows a
// button that can't work or an answer that may be out of date (globals.css hides it there). The
// button waits for the page (docs/ui-design.md "Forms wait for the page"); the browser sends only
// the shift.
export function StillComingCard({
  shiftId,
  saidAt,
  timeZone,
  main,
  cancel,
}: {
  shiftId: string;
  saidAt: Date | null;
  timeZone: string;
  main: boolean; // the page's main button (the shift's page), or clear glass (the pass)
  cancel: ReactNode;
}) {
  // The shift's page: a section heading like its cards' (h2); the pass: under the pass's own (h3).
  const Heading = main ? "h2" : "h3";
  const router = useRouter();
  const ready = useHydrated();
  const headingId = `still-coming-${shiftId}`;
  const [said, setSaid] = useState<Date | null>(saidAt);
  const [thanks, setThanks] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);

  const yes = () => {
    if (sending.current) return;
    sending.current = true;
    setProblem(null);
    startTransition(async () => {
      const result = await stillComingAction(shiftId).catch(() => ({ status: "error" as const }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else if (result.status === "confirmed" || result.status === "already") {
        setSaid(new Date(result.at));
        setThanks(true);
      } else if (result.status === "not_now") setProblem(STILL_COMING_NOT_NOW);
      else setProblem(STILL_COMING_ERROR);
    });
  };

  return (
    <section
      data-online-only=""
      data-still-coming=""
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-row glass-tile p-4"
    >
      <Heading id={headingId} className="text-lg font-semibold text-ink">
        {STILL_COMING_TITLE}
      </Heading>
      {thanks && <Slip tone="done" role="status" title={STILL_COMING_THANKS} />}
      {said ? (
        <p data-said-coming="" className="flex items-center gap-3 text-lg text-ink">
          <span aria-hidden="true" className={`${disc.base} ${disc.done}`}>
            <Icon name="check" size={18} />
          </span>
          {saidComingText(said, timeZone)}
        </p>
      ) : (
        <button
          type="button"
          disabled={!ready || pending}
          onClick={yes}
          className={main ? staffBtn.primary : staffBtn.secondary}
        >
          <Icon name="check" size={22} />
          {YES_COMING}
        </button>
      )}
      {problem && (
        <p role="alert" className="text-base font-semibold text-urgent-ink">
          {problem}
        </p>
      )}
      {cancel}
    </section>
  );
}
