"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, card, field, headingGap, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { detailsResultText } from "@/lib/office/shifts-copy";
import { RequirementsPicker } from "../requirements-picker";
import { resultBox } from "../shift-tones";
import { editShiftDetailsAction } from "../actions";

const input = `${field} w-full`;

export interface DetailsDefaults {
  payRate: string;
  post: string;
  meetingPoint: string;
  uniform: string;
  requirements: string[];
}

// "Session details" (docs/office-v2.md S2): set here for every shift, a Google Sheet's or a
// file's too, since the sync and the import never write them, but not one from the firm's planner
// (its API sends them; the page leaves this form out). With people booked the extra
// requirements are locked (they were checked against the old list). Every field and the button
// wait for the page (docs/ui-design.md "Forms wait for the page").
export function SessionDetailsForm({
  shiftId,
  defaults,
  qualifications,
  requirementsLocked,
}: {
  shiftId: string;
  defaults: DetailsDefaults;
  qualifications: { code: string; name: string }[];
  requirementsLocked: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(defaults);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const set = (patch: Partial<DetailsDefaults>) => setValues((v) => ({ ...v, ...patch }));
  const save = () =>
    startTransition(async () => {
      const result = await editShiftDetailsAction(shiftId, values).catch(() => ({
        status: "error" as const,
      }));
      setMessage(detailsResultText(result));
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelStack}>
          Pay rate, £ an hour (optional)
          <input
            inputMode="decimal"
            className={input}
            value={values.payRate}
            onChange={(e) => set({ payRate: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={labelStack}>
          Post (optional)
          <input
            className={input}
            value={values.post}
            maxLength={200}
            onChange={(e) => set({ post: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={labelStack}>
          Meeting point (optional)
          <input
            className={input}
            value={values.meetingPoint}
            maxLength={300}
            onChange={(e) => set({ meetingPoint: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={labelStack}>
          Uniform (optional)
          <input
            className={input}
            value={values.uniform}
            maxLength={300}
            onChange={(e) => set({ uniform: e.target.value })}
            disabled={!ready}
          />
        </label>
      </div>
      <RequirementsPicker
        options={qualifications}
        value={values.requirements}
        onChange={(requirements) => set({ requirements })}
        disabled={!ready}
        locked={
          requirementsLocked ? "People are booked on this shift, so these can't change." : undefined
        }
      />
      <button type="submit" className={`${btn.primary} self-start`} disabled={pending || !ready}>
        Save details
      </button>
      {message && (
        <p role="status" className={resultBox}>
          {message}
        </p>
      )}
    </form>
  );
}
