"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  BASELINE_KEYS,
  BASELINE_METRICS,
  TALLY_KEYS,
  type BaselineMetric,
} from "@/lib/metrics/definitions";
import { saveFiguresText, updateNowText } from "@/lib/office/pilot-copy";
import { saveFiguresAction, updateFiguresNowAction } from "./actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const field = "rounded border border-slate-400 px-2 py-1";
const failed = { status: "error" as const };

// "Baseline (week 0)" and "This week's tally": one field per figure (blank keeps what's there),
// the week, and a save button. The server checks everything again.
export function FiguresForm({
  kind,
  week,
  current,
}: {
  kind: "baseline" | "tally";
  week: string; // yyyy-mm-dd
  current: Partial<Record<BaselineMetric, number>>;
}) {
  const router = useRouter();
  const keys: readonly BaselineMetric[] = kind === "baseline" ? BASELINE_KEYS : TALLY_KEYS;
  const [weekStart, setWeekStart] = useState(week);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(keys.map((k) => [k, current[k] === undefined ? "" : String(current[k])])),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const save = () =>
    startTransition(async () => {
      const result = await saveFiguresAction(kind, weekStart, values).catch(() => failed);
      setMessage(saveFiguresText(result, kind));
      if (result.status === "saved") router.refresh();
    });
  const id = (key: string) => `${kind}-${key}`;
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col">
        <label htmlFor={id("week")} className="font-semibold">
          {kind === "baseline" ? "The week you counted (its first day)" : "Week (any day in it)"}
        </label>
        <input
          id={id("week")}
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className={`${field} self-start`}
        />
      </div>
      {keys.map((key) => (
        <div key={key} className="flex flex-col">
          <label htmlFor={id(key)} className="font-semibold">
            {BASELINE_METRICS[key].label}
          </label>
          <input
            id={id(key)}
            inputMode="decimal"
            value={values[key] ?? ""}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            className={`${field} max-w-xs`}
          />
        </div>
      ))}
      <button type="submit" className={`${button} self-start`} disabled={pending || !ready}>
        {kind === "baseline" ? "Save the baseline" : "Save this week's tally"}
      </button>
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </form>
  );
}

// Works out the daily figures now, rather than waiting for the night.
export function UpdateNowButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const update = () =>
    startTransition(async () => {
      const result = await updateFiguresNowAction().catch(() => failed);
      setMessage(updateNowText(result));
      if (result.status === "updated") router.refresh();
    });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={pending || !ready} onClick={update}>
        Update the figures now
      </button>
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
