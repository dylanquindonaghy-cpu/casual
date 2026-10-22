"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import {
  cancelBookingResultText,
  cancelShiftResultText,
  moveResultLines,
} from "@/lib/office/shifts-copy";
import {
  BOOKING_ONLY_REASONS,
  FIRM_CHANGE_REASONS,
  type FirmChangeReason,
} from "@/lib/roster/firm-reasons";
import { useHydrated } from "@/app/use-hydrated";
import { resultBox } from "../shift-tones";
import { cancelBookingAction, cancelShiftAction, moveShiftAction } from "../actions";
import { Chevron, summaryButton } from "./chevron";

const input = `${field} w-full`;
const failed = { status: "error" as const };

// A "Cancel …" opener: a <details> summary that looks like a destructive button.
const opener = `${btn.danger} ${summaryButton}`;

// Why the office is changing it (golden rule 12): required, from the fixed list.
function ReasonSelect({
  value,
  onChange,
  id,
  forBooking = false,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  forBooking?: boolean; // one person's booking: its own reasons too
}) {
  // Every field here waits for the page (docs/ui-design.md "Forms wait for the page").
  const ready = useHydrated();
  return (
    <label className={labelStack} htmlFor={id}>
      <span>Why?</span>
      <select
        id={id}
        className={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!ready}
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {Object.entries(FIRM_CHANGE_REASONS)
          .filter(
            ([code]) => forBooking || !BOOKING_ONLY_REASONS.includes(code as FirmChangeReason),
          )
          .map(([code, words]) => (
            <option key={code} value={code}>
              {words}
            </option>
          ))}
      </select>
    </label>
  );
}

// "Move or shorten": new date, times and/or site for everyone booked; each is told, with the
// notice they had logged. Anyone the rules now say no to is listed for the office.
export function MoveShiftForm({
  shiftId,
  defaults,
  sites,
}: {
  shiftId: string;
  defaults: { date: string; start: string; end: string; siteId: string };
  sites: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState({ ...defaults, reason: "" });
  const [lines, setLines] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const save = () =>
    startTransition(async () => {
      if (!values.reason) return setLines(["Choose a reason."]);
      const result = await moveShiftAction(shiftId, values).catch(() => failed);
      setLines(moveResultLines(result));
      if (result.status === "moved" || result.status === "curtailed") router.refresh();
    });
  return (
    <form
      className="mt-4 flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <label className={`${labelStack} col-span-2`}>
          <span>New date</span>
          <input
            type="date"
            className={input}
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={`${labelStack} sm:col-span-2`}>
          <span>New start</span>
          <input
            type="time"
            className={input}
            value={values.start}
            onChange={(e) => set({ start: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={`${labelStack} sm:col-span-2`}>
          <span>New finish</span>
          <input
            type="time"
            className={input}
            value={values.end}
            onChange={(e) => set({ end: e.target.value })}
            disabled={!ready}
          />
        </label>
        <label className={`${labelStack} col-span-2 sm:col-span-4`}>
          <span>Site</span>
          <select
            className={input}
            value={values.siteId}
            onChange={(e) => set({ siteId: e.target.value })}
            disabled={!ready}
          >
            <option value="">No site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ReasonSelect id="move-reason" value={values.reason} onChange={(reason) => set({ reason })} />
      <button type="submit" className={`${btn.primary} self-start`} disabled={pending || !ready}>
        Move for everyone booked
      </button>
      {lines.length > 0 && (
        <div role="status" className={resultBox}>
          <p>{lines[0]}</p>
          {lines.length > 1 && (
            <ul className="mt-1 list-disc pl-6 font-normal">
              {lines.slice(1).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

// "Cancel this shift": everyone booked is told, and the notice they had is logged.
export function CancelShiftForm({ shiftId, booked }: { shiftId: string; booked: number }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const cancel = () =>
    startTransition(async () => {
      if (!reason) return setMessage("Choose a reason.");
      const result = await cancelShiftAction(shiftId, reason).catch(() => failed);
      setMessage(cancelShiftResultText(result));
      if (result.status === "cancelled") router.refresh();
    });
  return (
    <details className={booked > 0 ? "group mt-6 border-t border-line pt-6" : "group"}>
      <summary className={opener}>
        Cancel this shift
        <Chevron />
      </summary>
      <div className="mt-4 flex flex-col gap-4 rounded-row border border-urgent-line bg-urgent-soft p-4">
        <p>
          {booked === 0
            ? "Nobody is booked on it."
            : `${booked === 1 ? "1 person is" : `${booked} people are`} booked: each is told, and the notice they had is logged.`}
        </p>
        <ReasonSelect id="cancel-reason" value={reason} onChange={setReason} />
        <button
          type="button"
          className={`${btn.dangerSolid} self-start`}
          disabled={pending || !ready}
          onClick={cancel}
        >
          Yes, cancel this shift
        </button>
        {message && (
          <p role="status" className={resultBox}>
            {message}
          </p>
        )}
      </div>
    </details>
  );
}

// "Cancel {name}'s booking", with a reason: they're told, with the notice they had logged. On the
// shift's page the page refreshes to show it; on the dashboard (refreshOnDone false) a refresh would take
// the booking, and this confirmation with it, off the list, so the confirmation stays in place of
// the button and the list updates on the next visit.
export function CancelBookingForm({
  shiftId,
  workerId,
  name,
  refreshOnDone = true,
  onDone,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  refreshOnDone?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const cancel = () =>
    startTransition(async () => {
      if (!reason) return setMessage("Choose a reason.");
      const result = await cancelBookingAction(shiftId, workerId, reason).catch(() => failed);
      setMessage(cancelBookingResultText(result, name));
      if (result.status === "cancelled") {
        setDone(true);
        onDone?.();
        if (refreshOnDone) router.refresh();
      }
    });
  return (
    <details className="group" open={done || undefined}>
      <summary className={opener}>
        Cancel {name}&apos;s booking
        <Chevron />
      </summary>
      <div
        className={`mt-3 flex max-w-md flex-col gap-3 ${
          done ? "" : "rounded-row border border-urgent-line bg-urgent-soft p-4"
        }`}
      >
        {!done && (
          <>
            <ReasonSelect
              id={`cancel-${shiftId}-${workerId}`}
              value={reason}
              onChange={setReason}
              forBooking
            />
            <button
              type="button"
              className={`${btn.dangerSolid} self-start`}
              disabled={pending || !ready}
              onClick={cancel}
            >
              Yes, cancel {name}&apos;s booking
            </button>
          </>
        )}
        {message && (
          <p role="status" className={resultBox}>
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
