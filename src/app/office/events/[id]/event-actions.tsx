"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  KEEP_AS_IS,
  OFFERS_GOING,
  offerBestButton,
  OFFER_OPEN_CONFIRM,
  OFFER_OPEN_YES,
  offerOpenPlacesButton,
  offerOpenResultText,
  offerPlaceResultText,
  showButton,
} from "@/lib/office/event-page-copy";
import { showingResultText } from "@/lib/office/shifts-copy";
import { btn } from "../../../ui/classes";
import { Icon } from "../../../ui/icons";
import { setShowingAction } from "../../shifts/actions";
import { offerOnePlaceAction, offerOpenPlacesAction } from "../../today-actions";

const failed = { status: "error" as const };

// An event's page's buttons (Phase 26.5, evt-1 and evt-4), each one the office's existing action:
// "Hide from casuals" / "Show to casuals" (the event's switch, setShowingAction); "Offer N open
// places" (each open session in the urgent window offered, after a "Yes": offerOpenPlacesAction);
// "Offer to the best 5" on an open place (that session offered: offerOnePlaceAction). The server checks the
// office user and logs each; the page then reads its figures again. The answer stays beside the
// button. They wait for the page (docs/ui-design.md "Forms wait for the page").

// Mounted from the start, so a screen reader hears the answer when it arrives.
function Answer({ text }: { text: string | null }) {
  return (
    <p role="status" className={text ? "basis-full text-sm text-ink-muted" : "sr-only"}>
      {text ?? ""}
    </p>
  );
}

export function ShowHideButton({ eventId, showing }: { eventId: string; showing: boolean }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const flip = () =>
    start(async () => {
      const r = await setShowingAction({ target: "event", id: eventId, showing: !showing }).catch(
        () => failed,
      );
      setSaid(showingResultText(r, "event"));
      if (r.status === "shown" || r.status === "hidden") router.refresh();
    });
  return (
    <>
      <button type="button" onClick={flip} disabled={pending || !ready} className={btn.secondary}>
        <Icon name="eye" size={16} />
        {showButton(showing)}
      </button>
      <Answer text={said} />
    </>
  );
}

export function OfferOpenPlaces({ eventId, places }: { eventId: string; places: number }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  // The "Yes" step takes the focus when it opens; closing it gives it back to the button.
  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);
  const close = () => {
    setAsking(false);
    trigger.current?.focus();
  };
  const offer = () =>
    start(async () => {
      const r = await offerOpenPlacesAction(eventId).catch(() => failed);
      setSaid(offerOpenResultText(r));
      close();
      if (r.status === "offered") router.refresh();
    });
  return (
    <>
      {places > 0 && (
        <button
          ref={trigger}
          type="button"
          aria-expanded={asking}
          aria-controls="offer-open-confirm"
          onClick={() => setAsking(true)}
          disabled={pending || !ready}
          className={btn.primary}
        >
          <Icon name="send" size={16} />
          {offerOpenPlacesButton(places)}
        </button>
      )}
      {asking && (
        <div
          id="offer-open-confirm"
          className="flex basis-full flex-col gap-3 rounded-row glass-tile p-4"
        >
          <p className="text-sm text-ink">{OFFER_OPEN_CONFIRM}</p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={yes}
              type="button"
              onClick={offer}
              disabled={pending}
              className={btn.primary}
            >
              {OFFER_OPEN_YES}
            </button>
            <button type="button" onClick={close} className={btn.secondary}>
              {KEEP_AS_IS}
            </button>
          </div>
        </div>
      )}
      <Answer text={said} />
    </>
  );
}

// One open place's offers: the button while nothing's going out, and "Offers are going out." once
// they are; one component either way, so its answer stays (and is heard) after the page redraws.
export function OfferBest({
  shiftId,
  firstWave,
  name,
  offering,
}: {
  shiftId: string;
  firstWave: number | null;
  name: string; // the session's, so each button reads as its own (aud-5)
  offering: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const words = offerBestButton(firstWave);
  const offer = () =>
    start(async () => {
      const r = await offerOnePlaceAction(shiftId).catch(() => failed);
      setSaid(offerPlaceResultText(r));
      if (r.status === "offering" || r.status === "offering_hidden") router.refresh();
    });
  return (
    <div className="flex flex-1 flex-col gap-2">
      {!offering && (
        <button
          type="button"
          onClick={offer}
          disabled={pending || !ready}
          aria-label={`${words}: ${name}`}
          className={btn.primary}
        >
          <Icon name="send" size={16} />
          {words}
        </button>
      )}
      <p role="status" className="text-sm text-ink-muted">
        {said ?? (offering ? OFFERS_GOING : "")}
      </p>
    </div>
  );
}
