"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, checkStep, confirmStep, field, hint, label } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import {
  acceptResultText,
  answerResultText,
  ASK_LABEL,
  DECLINE_LABEL,
  plannerDoneText,
} from "@/lib/client/office-copy";
import {
  FIRM_CHANGE_REASONS,
  SHIFT_CHANGE_REASON_CODES,
  type FirmChangeReason,
} from "@/lib/roster/firm-reasons";
import {
  acceptClientRequestAction,
  askClientAction,
  declineClientRequestAction,
  markPlannerDoneAction,
} from "./actions";

// The buttons under a client request on Client requests (Phase 36.4; the approved mock-up): Accept
// (its words say what it does: "Accept and offer the places"), "Decline…" (a reason the client
// sees, required), "Ask the client" (the question, required), and on "To do in {planner}" "Mark
// done". Accepting that cancels bookings or moves people booked asks "Yes, …" first (a red step);
// a reason from the firm's list for new times or a cancel, "Offer the places now" for more places,
// and a venue for a new event. Every answer ends with its confirmation (or why nothing changed),
// kept while the page refreshes under it (`stayOn`: this request stays chosen). Waits for the page.

export interface AcceptOptions {
  label: string; // the main button's words
  offer: boolean; // more places that would be offered now: "Offer the places now" (on)
  reason: FirmChangeReason | null; // new times, cancel: the reason's default (the list offered)
  // "Yes, …" first: the words of the step (bookings cancelled, or people booked moved).
  confirm: string | null;
  venues: { siteId: string; name: string }[] | null; // a new event: where to make it
  venue: string; // its default ("" when the office must choose)
}

type Mode = null | "decline" | "ask" | "confirm";

export function RequestActions({
  requestId,
  canAnswer,
  plannerToDo,
  accept,
  stayOn,
}: {
  requestId: string;
  canAnswer: boolean;
  plannerToDo: boolean;
  accept: AcceptOptions | null; // null: it can't be accepted as it stands (decline or ask)
  stayOn: string;
}) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [words, setWords] = useState("");
  const [offer, setOffer] = useState(accept?.offer ?? false);
  const [reason, setReason] = useState<FirmChangeReason | "">(accept?.reason ?? "");
  const [venue, setVenue] = useState(accept?.venue ?? "");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ done: boolean; text: string } | null>(null);
  const off = !ready || pending;

  const settle = (done: boolean, text: string) => {
    setResult({ done, text });
    if (done) {
      setMode(null);
      if (`${window.location.pathname}${window.location.search}` !== stayOn) {
        router.replace(stayOn, { scroll: false });
      } else router.refresh();
    }
  };
  const doAccept = () =>
    start(async () => {
      const r = await acceptClientRequestAction({
        requestId,
        ...(accept?.offer ? { offer } : {}),
        ...(accept?.reason && reason ? { reason } : {}),
        ...(accept?.venues && venue ? { siteId: venue } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }).catch(() => ({ status: "error" as const }));
      settle(r.status === "accepted" || r.status === "planner", acceptResultText(r));
    });

  if (result?.done) {
    return (
      <Slip tone="done" role="status" title="Done">
        <p>{result.text}</p>
      </Slip>
    );
  }

  const problem = result && !result.done && (
    <p role="alert" className="font-semibold text-urgent-ink">
      {result.text}
    </p>
  );

  if (plannerToDo) {
    return (
      <div className="flex flex-col gap-3">
        <p className={hint}>Made the change in your planner? Mark it done.</p>
        <button
          type="button"
          disabled={off}
          className={`${btn.primary} self-start`}
          onClick={() =>
            start(async () => {
              const r = await markPlannerDoneAction(requestId).catch(() => ({
                status: "error" as const,
              }));
              settle(r.status === "done", plannerDoneText(r));
            })
          }
        >
          Mark done
        </button>
        {problem}
      </div>
    );
  }
  if (!canAnswer) return null;

  return (
    <div className="flex flex-col gap-4">
      {accept && (accept.offer || accept.reason || accept.venues) && mode === null && (
        <div className="flex flex-col gap-3">
          {accept.venues && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-venue`} className={label}>
                Make it at
              </label>
              <select
                disabled={!ready}
                id={`${id}-venue`}
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className={`${field} w-full sm:w-80`}
              >
                <option value="">Choose one of the contract&apos;s venues</option>
                {accept.venues.map((v) => (
                  <option key={v.siteId} value={v.siteId}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {accept.reason && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-reason`} className={label}>
                Reason casuals are told
              </label>
              <select
                disabled={!ready}
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value as FirmChangeReason)}
                className={`${field} w-full sm:w-96`}
              >
                {SHIFT_CHANGE_REASON_CODES.map((c) => (
                  <option key={c} value={c}>
                    {FIRM_CHANGE_REASONS[c]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {accept.offer && (
            <label className="flex min-h-11 items-center gap-3 font-medium">
              <input
                disabled={!ready}
                type="checkbox"
                checked={offer}
                onChange={(e) => setOffer(e.target.checked)}
                className="size-5 accent-ink"
              />
              Offer the places now
            </label>
          )}
        </div>
      )}
      {accept && mode === null && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-note`} className={label}>
            A word to the client (optional)
          </label>
          <input
            disabled={!ready}
            id={`${id}-note`}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            className={`${field} w-full`}
          />
        </div>
      )}

      {mode === null && (
        <div className="flex flex-wrap gap-3">
          {accept && (
            <button
              type="button"
              disabled={off}
              className={btn.primary}
              onClick={() => {
                setResult(null);
                if (accept.confirm) setMode("confirm");
                else doAccept();
              }}
            >
              {pending ? "Working…" : accept.label}
            </button>
          )}
          <button
            type="button"
            disabled={off}
            className={btn.secondary}
            onClick={() => {
              setResult(null);
              setWords("");
              setMode("decline");
            }}
          >
            Decline…
          </button>
          <button
            type="button"
            disabled={off}
            className={btn.secondary}
            onClick={() => {
              setResult(null);
              setWords("");
              setMode("ask");
            }}
          >
            Ask the client
          </button>
        </div>
      )}

      {mode === "confirm" && accept?.confirm && (
        <div className={`${confirmStep} flex flex-col gap-3`}>
          <p className="font-semibold">{accept.confirm}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={off} className={btn.dangerSolid} onClick={doAccept}>
              {pending
                ? "Working…"
                : `Yes, ${accept.label.charAt(0).toLowerCase()}${accept.label.slice(1)}`}
            </button>
            <button
              type="button"
              disabled={off}
              className={btn.secondary}
              onClick={() => setMode(null)}
            >
              Not yet
            </button>
          </div>
        </div>
      )}

      {(mode === "decline" || mode === "ask") && (
        <form
          className={`${mode === "decline" ? confirmStep : checkStep} flex flex-col gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await (
                mode === "decline"
                  ? declineClientRequestAction(requestId, words)
                  : askClientAction(requestId, words)
              ).catch(() => ({ status: "error" as const }));
              settle(
                r.status === "declined" || r.status === "asked",
                answerResultText(r, mode === "decline" ? "decline" : "ask"),
              );
            });
          }}
        >
          <label htmlFor={`${id}-words`} className={label}>
            {mode === "decline" ? DECLINE_LABEL : ASK_LABEL}
          </label>
          <textarea
            disabled={!ready}
            id={`${id}-words`}
            rows={3}
            maxLength={1000}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            className={`${field} w-full`}
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={off || !words.trim()}
              className={mode === "decline" ? btn.dangerSolid : btn.primary}
            >
              {mode === "decline" ? "Decline the request" : "Send the question"}
            </button>
            <button
              type="button"
              disabled={off}
              className={btn.secondary}
              onClick={() => setMode(null)}
            >
              Not yet
            </button>
          </div>
        </form>
      )}
      {problem}
    </div>
  );
}
