"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, card, field, headingGap, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { editResultText } from "@/lib/office/shifts-copy";
import { resultBox } from "../shift-tones";
import { editShiftAction } from "../actions";

// Fields fill their grid cell; locked ones (people booked) look locked.
const input = `${field} w-full disabled:cursor-not-allowed disabled:bg-quiet-soft disabled:text-ink-muted`;

export interface EditDefaults {
  date: string;
  start: string;
  end: string;
  role: string;
  siteId: string;
  headcount: string;
  instructions: string;
}

// "Edit this shift". With people booked, only places and instructions can change (the server
// says so if anything else was changed). Every field and the button wait for the page
// (docs/ui-design.md "Forms wait for the page").
export function EditShiftForm({
  shiftId,
  defaults,
  sites,
  booked,
}: {
  shiftId: string;
  defaults: EditDefaults;
  sites: { id: string; name: string }[];
  booked: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState(defaults);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const set = (patch: Partial<EditDefaults>) => setValues((v) => ({ ...v, ...patch }));
  const lockTimes = booked > 0;
  const locked = lockTimes || !ready;
  const save = () =>
    startTransition(async () => {
      const result = await editShiftAction(shiftId, values).catch(() => ({
        status: "error" as const,
      }));
      setMessage(editResultText(result));
      if (result.status === "saved") router.refresh();
    });
  return (
    <form
      className={`${card} ${headingGap} flex max-w-2xl flex-col gap-6`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {lockTimes && (
        <p className="rounded-row border border-line bg-quiet-soft px-3 py-2 text-quiet-ink">
          People are booked on this shift, so only the places and instructions can change here. To
          move or shorten it, use &quot;Move, shorten or cancel&quot; below.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <label className={`${labelStack} col-span-2`}>
          Date
          <input
            type="date"
            className={input}
            disabled={locked}
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </label>
        <label className={`${labelStack} sm:col-span-2`}>
          Start
          <input
            type="time"
            className={input}
            disabled={locked}
            value={values.start}
            onChange={(e) => set({ start: e.target.value })}
          />
        </label>
        <label className={`${labelStack} sm:col-span-2`}>
          Finish
          <input
            type="time"
            className={input}
            disabled={locked}
            value={values.end}
            onChange={(e) => set({ end: e.target.value })}
          />
        </label>
        <label className={`${labelStack} col-span-2`}>
          Role
          <input
            className={input}
            disabled={locked}
            value={values.role}
            onChange={(e) => set({ role: e.target.value })}
          />
        </label>
        <label className={`${labelStack} col-span-2 sm:col-span-3`}>
          Site
          <select
            className={input}
            disabled={locked}
            value={values.siteId}
            onChange={(e) => set({ siteId: e.target.value })}
          >
            <option value="">No site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelStack}>
          Places
          <input
            type="number"
            min={1}
            max={1000}
            className={input}
            value={values.headcount}
            onChange={(e) => set({ headcount: e.target.value })}
            disabled={!ready}
          />
        </label>
      </div>
      <label className={labelStack}>
        Instructions
        <textarea
          className={input}
          rows={3}
          value={values.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          disabled={!ready}
        />
      </label>
      <button type="submit" className={`${btn.primary} self-start`} disabled={pending || !ready}>
        Save changes
      </button>
      {message && (
        <p role="status" className={resultBox}>
          {message}
        </p>
      )}
    </form>
  );
}
