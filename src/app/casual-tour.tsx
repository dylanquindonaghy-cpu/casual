"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { CASUAL_TOUR_AGAIN, CASUAL_TOUR_STEPS, CASUAL_WELCOME } from "@/lib/tour/casual-copy";
import type { TourOutcome } from "@/lib/tour/seen";
import { TOUR_LATER_PREFIX } from "@/lib/tour/steps";
import { casualTourForHelpAction, markCasualTourSeenAction } from "./tour-actions";
import { TourHost, type TourApi } from "./tour/tour";
import { TourWelcome } from "./tour/welcome";
import { disc, tapRow } from "./ui/classes";
import { Icon } from "./ui/icons";
import { useHydrated } from "./use-hydrated";

// The casuals' first-login tour (Phase 33.3; docs/screens.md "## Phase 33", "### 33.3"): the shared
// engine (./tour/) with the casual video (portrait, 9:16) and seven steps on Home. Home carries it
// with `autoOpen` (her tour_seen_at not set yet): the welcome window opens there by itself once, and
// "Not now" holds for this login (laterKey, an HMAC of the session's id: src/lib/tour/later-key.ts).
// Profile and Help carry it for "Take the tour again" (<CasualTourAgain>), which opens the welcome
// window whether or not she's seen it; the walkthrough then goes to Home, whose own host carries on
// from where it is (session storage).
//
// Never in the copy kept for no signal (public/sw.js keeps `/`): the page renders nothing for the
// tour on the server (the window is drawn only in the browser), and in the browser nothing is drawn
// while the kept copy's notice is showing, so it can't open there, by itself or carrying on.
//
// Finishing or skipping marks it seen for the session's own casual (markCasualTourSeenAction; never
// in the demo's "Casual mobile view", where the server leaves Zoe's row alone), and this login's
// "Not now" is set too, so a page still holding the old answer doesn't open it again.

export const CASUAL_TOUR_VIDEO = {
  src: "/tour/casual.mp4",
  poster: "/tour/casual.jpg",
  captions: "/tour/casual.en.vtt",
} as const;

const KEPT_COPY = "[data-offline-notice]:not([hidden])";

export function CasualTour({
  firmName,
  seen,
  laterKey,
  autoOpen = false,
  apiRef,
}: {
  firmName: string;
  seen: boolean;
  laterKey: string;
  autoOpen?: boolean; // Home: opens by itself until she's seen it
  apiRef?: Ref<TourApi>;
}) {
  // Checked in the browser before anything is drawn: the copy kept for no signal never has it.
  const [live, setLive] = useState(false);
  useEffect(() => {
    // Read from the page as it arrived: not a render to keep in step.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive(document.querySelector(KEPT_COPY) === null);
  }, []);
  const Welcome = useCallback(
    ({ onStart, onNotNow }: { onStart: () => void; onNotNow: () => void }) => (
      <TourWelcome
        copy={{ ...CASUAL_WELCOME, title: CASUAL_WELCOME.title(firmName) }}
        video={CASUAL_TOUR_VIDEO}
        shape="tall"
        onStart={onStart}
        onNotNow={onNotNow}
      />
    ),
    [firmName],
  );
  const onEnd = useCallback(
    (outcome: TourOutcome) => {
      try {
        localStorage.setItem(`${TOUR_LATER_PREFIX}casual`, laterKey);
      } catch {
        // storage off: the server's answer is what counts
      }
      return markCasualTourSeenAction(outcome);
    },
    [laterKey],
  );
  if (!live) return null;
  return (
    <TourHost
      id="casual"
      steps={CASUAL_TOUR_STEPS}
      autoOpen={autoOpen && !seen}
      laterKey={laterKey}
      onEnd={onEnd}
      apiRef={apiRef}
      Welcome={Welcome}
    />
  );
}

// "Take the tour again" (Profile's row, Help's button): the welcome window, seen or not.
export function CasualTourAgain({
  firmName,
  seen,
  laterKey,
  look,
}: {
  firmName: string;
  seen: boolean;
  laterKey: string;
  look: "row" | "button";
}) {
  const api = useRef<TourApi>(null);
  const hydrated = useHydrated();
  const open = () => api.current?.open();
  const tour = <CasualTour firmName={firmName} seen={seen} laterKey={laterKey} apiRef={api} />;
  if (look === "button")
    return (
      <>
        <button
          type="button"
          data-tour-again=""
          disabled={!hydrated}
          onClick={open}
          className={`${tapRow} press glass-tile min-h-16 w-full rounded-row px-4 text-left disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <AgainWords />
        </button>
        {tour}
      </>
    );
  return (
    <li>
      <button
        type="button"
        data-tour-again=""
        disabled={!hydrated}
        onClick={open}
        className={`${tapRow} press min-h-20 w-full px-4 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <AgainWords />
      </button>
      {tour}
    </li>
  );
}

function AgainWords() {
  return (
    <>
      <span aria-hidden="true" className={`${disc.base} ${disc.quiet}`}>
        <Icon name="eye" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg leading-snug font-medium text-ink">
          {CASUAL_TOUR_AGAIN.title}
        </span>{" "}
        <span className="block text-base text-ink-muted">{CASUAL_TOUR_AGAIN.sub}</span>
      </span>
      <Icon name="chevron" size={22} className="text-ink-muted" />
    </>
  );
}

// Help's "Take the tour again": Help is open to anyone, so the page itself reads no session; once
// it's showing, this asks whether a casual is logged in here (casualTourForHelpAction) and shows the
// button only for her.
export function HelpTourAgain() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof casualTourForHelpAction>>>(null);
  useEffect(() => {
    let live = true;
    casualTourForHelpAction()
      .then((r) => {
        if (live) setMe(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!me) return null;
  return (
    <div className="mb-6">
      <CasualTourAgain look="button" firmName={me.firmName} seen={me.seen} laterKey={me.laterKey} />
    </div>
  );
}
