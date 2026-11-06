"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { tryAgainText } from "@/lib/portal/copy";
import {
  DECLINE_STEP,
  declineOutcomeText,
  type DeclineShown,
  type RowText,
} from "@/lib/portal/home-copy";
import { declineOfferAction } from "./offer-actions";
import {
  confirmStep,
  headingGap,
  muted,
  nums,
  staffBtn,
  staffBtnInline,
  staffH2,
  tapRow,
} from "./ui/classes";
import { Icon } from "./ui/icons";
import { DateTile } from "./ui/sign";
import { Slip } from "./ui/slip";
import { useHydrated } from "./use-hydrated";

// "Offered to you" on Home (Phase 28.15; docs/screens.md "### 28.15"), above "Shifts you can
// take", only while she has offers still open to her (src/lib/portal/my-offers.ts), and online only
// (an offer can close at any moment). One glass section like Home's others; each offer a clear
// glass tile: its day as the lead, "Steward · Raceday", the day, times and site, a chevron (the
// tile opens the shift's page, where "Take shift" books it as always), then "Offered 21:20. First
// to take it gets it." and "No thanks". "No thanks" opens a step ("Say no to this shift?"); "Yes,
// say no" sends it, the offer leaves the list and a slip under the heading says what happened.
// Never who else was offered.

export interface OfferRow {
  offerId: string;
  shiftId: string;
  day: { dow: string; day: string };
  text: RowText & { offered: string };
}

export function OfferedToYou({ offers }: { offers: OfferRow[] }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<DeclineShown | null>(null);
  const left = offers.filter((o) => !gone.has(o.offerId));
  const done = (offerId: string, result: DeclineShown, remove: boolean) => {
    setShown(result);
    if (remove) setGone((g) => new Set(g).add(offerId));
  };
  return (
    <section
      data-online-only=""
      aria-labelledby="offered-heading"
      className="glass animate-in rounded-inner p-4"
    >
      <div className="flex items-center gap-3 px-1">
        <h2 id="offered-heading" className={staffH2}>
          Offered to you
        </h2>
      </div>
      {shown && (
        <Slip
          tone={shown.tone}
          title={shown.title}
          role={shown.tone === "urgent" ? "alert" : "status"}
          className={`${headingGap} ${nums}`}
        >
          {shown.line && <p>{shown.line}</p>}
        </Slip>
      )}
      {left.length > 0 && (
        <ul role="list" className={`${headingGap} flex flex-col gap-2`}>
          {left.map((o) => (
            <Offer key={o.offerId} offer={o} done={done} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Offer({
  offer,
  done,
}: {
  offer: OfferRow;
  done: (offerId: string, result: DeclineShown, remove: boolean) => void;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const stepId = `decline-${offer.offerId}`;

  const sayNo = () => {
    if (sending.current) return;
    sending.current = true;
    startTransition(async () => {
      const result = await declineOfferAction(offer.offerId).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") {
        router.replace("/login");
        return;
      }
      const words = declineOutcomeText(result.status, tryAgainText());
      // A failed tap keeps the offer and its step to try again; any other answer closes it.
      done(offer.offerId, words, result.status !== "error");
    });
  };

  return (
    <li data-for-you="offer" data-offer={offer.shiftId} className="glass-tile rounded-row">
      <Link href={`/shifts/${offer.shiftId}`} className={`${tapRow} press min-h-20 rounded-row`}>
        <DateTile dow={offer.day.dow} day={offer.day.day} />
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-snug font-medium text-ink">
            {offer.text.title}
          </span>{" "}
          <span className="block text-base text-ink-muted">{offer.text.sub}</span>
        </span>
        <Icon name="chevron" size={22} className="text-ink-muted" />
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 pb-3.5">
        <p className={`${muted} ${nums}`}>{offer.text.offered}</p>
        {!asking && (
          <button
            type="button"
            disabled={!ready}
            onClick={() => setAsking(true)}
            className={staffBtnInline}
          >
            {DECLINE_STEP.button}
          </button>
        )}
      </div>
      {asking && (
        <div role="group" aria-labelledby={stepId} className={`${confirmStep} mx-3.5 mb-3.5`}>
          <p id={stepId} className="font-semibold">
            {DECLINE_STEP.title}
          </p>
          <p className="mt-1">{DECLINE_STEP.line}</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <button
              type="button"
              disabled={pending || !ready}
              onClick={sayNo}
              className={staffBtn.dangerSolid}
            >
              {pending ? DECLINE_STEP.sending : DECLINE_STEP.yes}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(false)}
              className={staffBtn.secondary}
            >
              {DECLINE_STEP.keep}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
