"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  KEEP_AS_IS,
  offerBestButton,
  OFFER_OPEN_CONFIRM,
  OFFER_OPEN_YES,
  offerOpenPlacesButton,
  offerOpenResultText,
  showButton,
} from "@/lib/office/event-page-copy";
import { showingResultText } from "@/lib/office/shifts-copy";
import { urgentResultText } from "@/lib/office/today-copy";
import { btn } from "../../../ui/classes";
import { Icon } from "../../../ui/icons";
import { setShowingAction } from "../../shifts/actions";
import { offerOpenPlacesAction, setUrgentAction } from "../../today-actions";

const failed = { status: "error" as const };

// An event's page's buttons (Phase 26.5, evt-1 and evt-4), each one the office's existing action:
// "Hide from casuals" / "Show to casuals" (the event's switch, setShowingAction); "Offer N open
// places" (each open session marked urgent, after a "Yes": offerOpenPlacesAction); "Offer to the
// best 5" on an open place (that session marked urgent: setUrgentAction). The server checks the
// office user and logs each; the page then reads its figures again. The answer stays beside the
// button. They wait for the page (docs/ui-design.md "Forms wait for the page").

function Answer({ text }: { text: string | null }) {
  return text ? (
    <p role="status" className="basis-full text-sm text-ink-muted">
      {text}
    </p>
  ) : null;
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
  const offer = () =>
    start(async () => {
      const r = await offerOpenPlacesAction(eventId).catch(() => failed);
      setSaid(offerOpenResultText(r));
      setAsking(false);
      if (r.status === "offered") router.refresh();
    });
  if (places === 0) return null;
  return (
    <>
      <button
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
      {asking && (
        <div
          id="offer-open-confirm"
          className="flex basis-full flex-col gap-3 rounded-row glass-tile p-4"
        >
          <p className="text-sm text-ink">{OFFER_OPEN_CONFIRM}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={offer} disabled={pending} className={btn.primary}>
              {OFFER_OPEN_YES}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={btn.secondary}>
              {KEEP_AS_IS}
            </button>
          </div>
        </div>
      )}
      <Answer text={said} />
    </>
  );
}

export function OfferBest({
  shiftId,
  firstWave,
  name,
}: {
  shiftId: string;
  firstWave: number | null;
  name: string; // the session's, so each button reads as its own (aud-5)
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const words = offerBestButton(firstWave);
  const offer = () =>
    start(async () => {
      const r = await setUrgentAction(shiftId, true).catch(() => failed);
      setSaid(urgentResultText(r));
      if (r.status === "marked" || r.status === "marked_hidden") router.refresh();
    });
  return (
    <>
      <button
        type="button"
        onClick={offer}
        disabled={pending || !ready}
        aria-label={`${words}: ${name}`}
        className={`${btn.primary} flex-1`}
      >
        <Icon name="send" size={16} />
        {words}
      </button>
      <Answer text={said} />
    </>
  );
}
