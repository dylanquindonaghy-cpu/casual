"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { label, labelStack, muted, staffBtn, staffField } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import {
  TRAVEL_MINUTES,
  TRAVEL_MODES,
  type TravelMinutes,
  type TravelMode,
} from "@/lib/travel/modes";
import { isOnline } from "@/lib/portal/copy";
import {
  removeTravelText,
  saveTravelText,
  TRAVEL_MINUTE_WORDS,
  type RemoveTravelOutcome,
  type SaveTravelOutcome,
} from "@/lib/portal/travel-copy";
import { TRAVEL_MODE_WORDS } from "@/lib/travel/copy";
import { POSTCODE_INPUT_MAX } from "@/lib/travel/postcode";
import { removeTravelAction, saveTravelAction } from "./actions";

// One answer to pick from, as a big bordered row; the picked one is outlined in ink (as the
// notification settings).
const choice =
  "flex min-h-14 items-center gap-3 rounded-xl border-2 border-line-strong bg-card px-4 py-3 has-checked:border-ink has-checked:bg-quiet-soft";

const failed = { status: "error" as const };
const NO_SIGNAL = "No signal. Try again when you have signal.";

// The start-from postcode, how they travel and how long for: "Save travel area" (the postcode is
// looked up first; one it can't find saves nothing). "Remove my travel area" asks first. Waits for
// the page (docs/ui-design.md "Forms wait for the page").
export function TravelForm({
  travel,
  signOff,
}: {
  travel: { set: boolean; postcode: string | null; modes: TravelMode; maxMinutes: TravelMinutes };
  signOff: string;
}) {
  const router = useRouter();
  const [postcode, setPostcode] = useState(travel.postcode ?? "");
  const [modes, setModes] = useState<TravelMode>(travel.modes);
  const [maxMinutes, setMaxMinutes] = useState<TravelMinutes>(travel.maxMinutes);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const busy = pending || !ready;

  const answer = (text: string, ok: boolean, refresh: boolean) => {
    setMessage({ text, alert: !ok });
    if (refresh) router.refresh();
  };

  const save = () =>
    startTransition(async () => {
      if (!isOnline()) return answer(NO_SIGNAL, false, false);
      const result: SaveTravelOutcome = await saveTravelAction(postcode, modes, maxMinutes).catch(
        () => failed,
      );
      if (result.status === "logged_out") return router.replace("/login");
      answer(
        saveTravelText(result),
        result.status === "saved" || result.status === "unchanged",
        result.status === "saved",
      );
    });

  const remove = () =>
    startTransition(async () => {
      if (!isOnline()) return answer(NO_SIGNAL, false, false);
      const result: RemoveTravelOutcome = await removeTravelAction().catch(() => failed);
      if (result.status === "logged_out") return router.replace("/login");
      setAsking(false);
      if (result.status === "removed") setPostcode("");
      answer(removeTravelText(result), result.status === "removed", result.status === "removed");
    });

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className={labelStack}>
        Start-from postcode
        <input
          className={`${staffField} uppercase`}
          value={postcode}
          maxLength={POSTCODE_INPUT_MAX}
          autoComplete="postal-code"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setPostcode(e.target.value)}
          disabled={!ready}
        />
      </label>

      <fieldset className="mt-6">
        <legend className={label}>How do you travel?</legend>
        <div className="mt-2 space-y-2">
          {TRAVEL_MODES.map((m) => (
            <label key={m} className={choice}>
              <input
                type="radio"
                name="modes"
                value={m}
                checked={modes === m}
                onChange={() => setModes(m)}
                disabled={!ready}
                className="h-6 w-6 shrink-0 accent-ink"
              />
              <span>{TRAVEL_MODE_WORDS[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className={label}>How long will you travel, at most?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {TRAVEL_MINUTES.map((m) => (
            <label key={m} className={choice}>
              <input
                type="radio"
                name="maxMinutes"
                value={m}
                checked={maxMinutes === m}
                onChange={() => setMaxMinutes(m)}
                disabled={!ready}
                className="h-6 w-6 shrink-0 accent-ink"
              />
              <span>{TRAVEL_MINUTE_WORDS[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy || !postcode.trim()}
        className={`${staffBtn.primary} mt-6`}
      >
        Save travel area
      </button>

      {message && (
        <div
          role={message.alert ? "alert" : "status"}
          className={`mt-3 rounded-xl border-2 p-3 ${message.alert ? "border-urgent bg-urgent-soft font-semibold text-urgent-ink" : "border-done bg-done-soft"}`}
        >
          <p>{message.text}</p>
          {!message.alert && <p className={`mt-1 ${muted}`}>— {signOff}</p>}
        </div>
      )}

      {travel.set && !asking && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            setAsking(true);
          }}
          className={`${staffBtn.secondary} mt-6`}
        >
          Remove my travel area
        </button>
      )}
      {travel.set && asking && (
        <div className="mt-6 rounded-xl border-2 border-line-strong p-3">
          <p>Remove it? You&apos;ll see shifts wherever they are.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={busy} onClick={remove} className={staffBtn.dangerSolid}>
              Yes, remove it
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(false)}
              className={staffBtn.secondary}
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
