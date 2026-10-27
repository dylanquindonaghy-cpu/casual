"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { initials } from "@/lib/office/board-copy";
import type { OfferPage } from "@/lib/office/offer-page";
import {
  ALREADY_OFFERED,
  candidateLine,
  NOBODY_ELSE,
  NOBODY_YET,
  placesFreeText,
  RESPONSE_WORDS,
  sentBy,
  URGENT_NOTE,
  WHO_CAN_TAKE_IT,
  whoRule,
} from "@/lib/office/offer-words";
import { offerResultText } from "@/lib/office/today-copy";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { DAILY_OFFER_CAP } from "@/lib/rules/offer-cap";
import { btn, notice } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { StatusChip } from "../../ui/status-chip";
import { useHydrated } from "../../use-hydrated";
import { RESPONSE_TONE, WAITING_TONE } from "../shifts/shift-tones";
import { offerPanelAction, offerShiftAction, type OfferPanelResult } from "../today-actions";

// The offer panel (Phase 24, 24.3; round 7 of the canvas): "Offer to someone" without leaving the
// dashboard. A native <dialog> over a dimmed page, from the right from 1024px and from the foot on
// a phone, in the floating glass. It shows what the offer page shows, read by the offer page's own
// loader (offerPanelAction): the session, who can take it under the rules (each with "Send offer":
// "Sending…", then "Offered"), and who has been offered it and how they answered. The answer to a
// send shows at its foot ("Offer on its way to Kieran Doyle."). Escape, the scrim, Close and "Back
// to the dashboard" close it, focus goes back to what opened it, and the page reloads its data if
// an offer went. Opened by a card's paper plane or the detail card's "Offer to someone", both links
// to the offer page until the page is ready (and with a modifier key, as links). The dialog says
// when the page is ready (data-ready): the browser tests wait for it.

export const PANEL_TITLE_ID = "offer-panel-title";

const LOAD_WORDS: Record<Exclude<OfferPanelResult["status"], "found">, string> = {
  not_found: "We can't find that shift.",
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "Your role can't offer shifts.",
  error: "Something went wrong. Close this and try again.",
};

type Shown =
  { state: "loading" } | { state: "found"; page: OfferPage } | { state: "message"; words: string };

// Opens the panel for a session: the opener gets focus back when it closes.
export type OpenOffer = (shiftId: string, opener: HTMLElement) => void;

export function useOfferPanel(): { open: OpenOffer; panel: ReactNode } {
  const router = useRouter();
  const hydrated = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const asked = useRef(0);
  const sentAny = useRef(false);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ state: "loading" });

  useEffect(() => {
    const d = dialog.current;
    if (!shiftId || !d || d.open) return;
    d.showModal();
    heading.current?.focus({ preventScroll: true });
  }, [shiftId]);

  const open = useCallback<OpenOffer>((id, el) => {
    opener.current = el;
    const mine = ++asked.current;
    setShown({ state: "loading" });
    setShiftId(id);
    offerPanelAction(id)
      .catch((): OfferPanelResult => ({ status: "error" }))
      .then((r) => {
        if (mine !== asked.current) return;
        setShown(
          r.status === "found"
            ? { state: "found", page: r.page }
            : { state: "message", words: LOAD_WORDS[r.status] },
        );
      });
  }, []);

  const close = () => dialog.current?.close();

  const panel = (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={PANEL_TITLE_ID}
      data-offer-panel=""
      data-ready={hydrated ? "" : undefined}
      onClose={() => {
        asked.current += 1;
        setShiftId(null);
        opener.current?.focus({ preventScroll: true });
        opener.current = null;
        if (sentAny.current) {
          sentAny.current = false;
          router.refresh();
        }
      }}
      // The scrim: a click there lands on the dialog itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="top-auto bottom-0 left-0 m-0 h-auto max-h-[86dvh] w-full max-w-none overflow-hidden rounded-t-card glass-float p-0 text-base text-ink transition-[translate] duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/40 starting:translate-y-full lg:top-3 lg:right-3 lg:bottom-3 lg:left-auto lg:h-[calc(100dvh-1.5rem)] lg:max-h-none lg:w-[28rem] lg:max-w-[calc(100vw-1.5rem)] lg:rounded-card lg:starting:translate-x-[110%] lg:starting:translate-y-0"
    >
      {shiftId ? (
        <PanelBody
          key={shiftId}
          shown={shown}
          headingRef={heading}
          onClose={close}
          onSent={() => {
            sentAny.current = true;
          }}
        />
      ) : null}
    </dialog>
  );
  return { open, panel };
}

function PanelBody({
  shown,
  headingRef,
  onClose,
  onSent,
}: {
  shown: Shown;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onSent: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="flex max-h-[inherit] flex-col lg:h-full">
      <span
        aria-hidden="true"
        className="mx-auto mt-3 block h-1 w-10 shrink-0 rounded-full bg-button-line lg:hidden"
      />
      <div className="flex items-start gap-3 px-6 pt-4 lg:pt-6">
        <h2
          id={PANEL_TITLE_ID}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 text-2xl font-semibold tracking-heading text-ink focus:outline-none"
        >
          Offer this shift
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="press-glass glass-button inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-2 pb-6">
        {shown.state === "loading" ? (
          <p role="status" className="flex items-center gap-2 py-4 text-ink-muted">
            <span
              aria-hidden="true"
              className="size-4 animate-turn rounded-full border-2 border-current border-r-transparent"
            />
            Loading who can take it…
          </p>
        ) : shown.state === "message" ? (
          <p role="status" className={`${notice} mt-4`}>
            {shown.words}
          </p>
        ) : (
          <OfferContent page={shown.page} onSent={onSent} onConfirm={setConfirm} />
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-line px-6 pt-4 pb-6">
        <p
          role="status"
          className={confirm ? "flex items-center gap-2 font-medium text-ink" : "sr-only"}
        >
          {confirm ? <Icon name="check" size={18} className="text-done" /> : null}
          {confirm ?? ""}
        </p>
        <button type="button" onClick={onClose} className={`${btn.secondary} self-start`}>
          Back to the dashboard
        </button>
      </div>
    </div>
  );
}

// The panel's insides, as the offer page lays them out (offer-view.tsx): the same words.
export function OfferContent({
  page,
  onSent,
  onConfirm,
}: {
  page: OfferPage;
  onSent?: () => void;
  onConfirm?: (words: string) => void;
}) {
  const { shift, timeZone } = page;
  return (
    <>
      <p className="text-base font-medium">
        <Link
          href={`/office/shifts/${shift.shiftId}`}
          className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          {roleLabel(shift.role)}
          {shift.site ? ` at ${shift.site}` : ""}
        </Link>
      </p>
      <p className="text-sm text-ink-muted tabular-nums">
        {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
        {shift.open ? ` · ${placesFreeText(shift.placesLeft)}` : ""}
      </p>
      {shift.open && shift.isUrgent && (
        <p className="mt-4 rounded-row bg-urgent-soft px-4 py-3 text-sm text-urgent-ink glass-rim">
          {URGENT_NOTE}
        </p>
      )}
      {!shift.open ? (
        <p className={`${notice} mt-4`}>This shift isn&apos;t open any more.</p>
      ) : shift.hidden ? (
        <p className={`${notice} mt-4`}>
          This shift is hidden from casuals, so it can&apos;t be offered. Show it to casuals first,
          or assign someone from the shift&apos;s page.
        </p>
      ) : (
        <>
          <h3 className="mt-6 text-base font-semibold">{WHO_CAN_TAKE_IT}</h3>
          <p className="mt-1 text-sm text-ink-muted">{whoRule(DAILY_OFFER_CAP)}</p>
          {page.candidates.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{NOBODY_ELSE}</p>
          ) : (
            <ul role="list" aria-label={WHO_CAN_TAKE_IT} className="mt-3 flex flex-col gap-2">
              {page.candidates.map((c) => (
                <li
                  key={c.workerId}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-row glass-tile px-3 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-wait-tile text-xs font-semibold text-wait-ink glass-rim"
                  >
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate font-medium">{c.name}</b>
                    <span className="block text-sm text-ink-muted tabular-nums">
                      {candidateLine(c)}
                    </span>
                  </span>
                  <SendButton
                    shiftId={shift.shiftId}
                    workerId={c.workerId}
                    name={c.name}
                    onSent={onSent}
                    onConfirm={onConfirm}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h3 className="mt-6 text-base font-semibold">{ALREADY_OFFERED}</h3>
      {page.offered.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{NOBODY_YET}</p>
      ) : (
        <ul role="list" aria-label={ALREADY_OFFERED} className="mt-2 flex flex-col gap-2 text-sm">
          {page.offered.map((o, i) => (
            <li key={`${o.worker}-${i}`} className="flex flex-wrap items-center gap-2 leading-7">
              <span className="font-medium text-ink">{o.worker}:</span>
              <StatusChip tone={o.response ? (RESPONSE_TONE[o.response] ?? "quiet") : WAITING_TONE}>
                {o.response ? RESPONSE_WORDS[o.response] : "waiting"}
              </StatusChip>
              <span className="text-ink-muted">
                ({sentBy(o.wave)}, {timeOnDay(o.sentAt, timeZone)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// "Send offer", then "Sending…" while it goes, then "Offered" (or what stopped it, at the panel's
// foot).
function SendButton({
  shiftId,
  workerId,
  name,
  onSent,
  onConfirm,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  onSent?: () => void;
  onConfirm?: (words: string) => void;
}) {
  const [state, setState] = useState<"ready" | "sending" | "sent">("ready");
  if (state === "sent")
    return (
      <span className="inline-flex min-h-10 items-center gap-2 px-3 text-sm font-medium text-done-ink">
        <Icon name="check" size={16} />
        Offered
      </span>
    );
  return (
    <button
      type="button"
      aria-label={state === "sending" ? `Sending offer to ${name}` : `Send offer to ${name}`}
      aria-disabled={state === "sending" ? "true" : undefined}
      onClick={() => {
        if (state !== "ready") return;
        setState("sending");
        offerShiftAction(shiftId, workerId)
          .catch(() => ({ status: "error" as const }))
          .then((result) => {
            onConfirm?.(offerResultText(result, name));
            if (["queued", "already_offered", "failed_before"].includes(result.status)) {
              setState("sent");
              onSent?.();
            } else setState("ready");
          });
      }}
      className="press-glass glass-button inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-ink hover:bg-button-hover active:bg-button-press"
    >
      {state === "sending" ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-turn rounded-full border-2 border-current border-r-transparent"
          />
          Sending…
        </>
      ) : (
        "Send offer"
      )}
    </button>
  );
}
