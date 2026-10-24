"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, label } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import {
  BASELINE_KEYS,
  BASELINE_METRICS,
  TALLY_KEYS,
  type BaselineMetric,
} from "@/lib/metrics/definitions";
import { saveFiguresText, updateNowText } from "@/lib/office/pilot-copy";
import { saveFiguresAction, updateFiguresNowAction } from "./actions";

const failed = { status: "error" as const };

// "Baseline (week 0)" and "This week's tally": one field per figure (blank keeps what's there),
// the week, and a save button (the tally's the page's sky main one; the baseline's plain). The
// server checks everything again. The figures sit in a grid (one column on a phone); each label is
// above its box, the boxes in a row line up at the bottom.
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
      className="mt-6 flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id("week")} className={label}>
          {kind === "baseline" ? "The week you counted (its first day)" : "Week (any day in it)"}
        </label>
        <input
          id={id("week")}
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          disabled={!ready}
          className={`${field} w-full sm:w-48`}
        />
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {keys.map((key) => (
          <div key={key} className="flex flex-col justify-between gap-1">
            <label htmlFor={id(key)} className={label}>
              {BASELINE_METRICS[key].label}
            </label>
            <input
              id={id(key)}
              inputMode="decimal"
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              disabled={!ready}
              className={`${field} w-full tabular-nums sm:max-w-48`}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          type="submit"
          className={kind === "tally" ? btn.primary : btn.secondary}
          disabled={pending || !ready}
        >
          {kind === "baseline" ? "Save the baseline" : "Save this week's tally"}
        </button>
        {message && (
          <p role="status" className="font-semibold">
            {message}
          </p>
        )}
      </div>
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
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn.secondary} disabled={pending || !ready} onClick={update}>
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
