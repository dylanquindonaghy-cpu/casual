"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { editResultText } from "@/lib/office/shifts-copy";
import { editShiftAction } from "../actions";

const input = "rounded border border-slate-400 px-2 py-1";
const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";

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
// says so if anything else was changed).
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
  const set = (patch: Partial<EditDefaults>) => setValues((v) => ({ ...v, ...patch }));
  const lockTimes = booked > 0;
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
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {lockTimes && (
        <p>
          People are booked on this shift, so only the places and instructions can change here. To
          move or shorten it, use &quot;Move, shorten or cancel&quot; below.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          <span>Date</span>
          <input
            type="date"
            className={input}
            disabled={lockTimes}
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>Start</span>
          <input
            type="time"
            className={input}
            disabled={lockTimes}
            value={values.start}
            onChange={(e) => set({ start: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>Finish</span>
          <input
            type="time"
            className={input}
            disabled={lockTimes}
            value={values.end}
            onChange={(e) => set({ end: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>Role</span>
          <input
            className={input}
            disabled={lockTimes}
            value={values.role}
            onChange={(e) => set({ role: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>Site</span>
          <select
            className={input}
            disabled={lockTimes}
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
        <label className="flex flex-col">
          <span>Places</span>
          <input
            type="number"
            min={1}
            max={1000}
            className={`${input} w-24`}
            value={values.headcount}
            onChange={(e) => set({ headcount: e.target.value })}
          />
        </label>
      </div>
      <label className="flex flex-col">
        <span>Instructions</span>
        <textarea
          className={input}
          rows={3}
          value={values.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </label>
      <button type="submit" className={button} disabled={pending}>
        Save changes
      </button>
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </form>
  );
}
