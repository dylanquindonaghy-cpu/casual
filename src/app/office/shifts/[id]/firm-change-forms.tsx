"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { cancelBookingAction, cancelShiftAction, moveShiftAction } from "../actions";

const input = "rounded border border-slate-400 px-2 py-1";
const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const failed = { status: "error" as const };

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
  return (
    <label className="flex flex-col" htmlFor={id}>
      <span className="font-semibold">Why?</span>
      <select id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
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
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          <span>New date</span>
          <input
            type="date"
            className={input}
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>New start</span>
          <input
            type="time"
            className={input}
            value={values.start}
            onChange={(e) => set({ start: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>New finish</span>
          <input
            type="time"
            className={input}
            value={values.end}
            onChange={(e) => set({ end: e.target.value })}
          />
        </label>
        <label className="flex flex-col">
          <span>Site</span>
          <select
            className={input}
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
      </div>
      <ReasonSelect id="move-reason" value={values.reason} onChange={(reason) => set({ reason })} />
      <button type="submit" className={button} disabled={pending || !ready}>
        Move for everyone booked
      </button>
      {lines.length > 0 && (
        <div role="status">
          <p className="font-semibold">{lines[0]}</p>
          {lines.length > 1 && (
            <ul className="list-disc pl-6">
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
    <details className="mt-3 rounded-lg border border-slate-300 px-3 py-2">
      <summary className="cursor-pointer font-semibold">Cancel this shift</summary>
      <p className="mt-2">
        {booked === 0
          ? "Nobody is booked on it."
          : `${booked === 1 ? "1 person is" : `${booked} people are`} booked: each is told, and the notice they had is logged.`}
      </p>
      <div className="mt-2">
        <ReasonSelect id="cancel-reason" value={reason} onChange={setReason} />
      </div>
      <button
        type="button"
        className={`${button} mt-2`}
        disabled={pending || !ready}
        onClick={cancel}
      >
        Yes, cancel this shift
      </button>
      {message && (
        <p role="status" className="mt-2 font-semibold">
          {message}
        </p>
      )}
    </details>
  );
}

// "Cancel {name}'s booking", with a reason: they're told, with the notice they had logged. On the
// shift's page the page refreshes to show it; on Today (refreshOnDone false) a refresh would take
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
    <details className="ml-2 inline-block" open={done || undefined}>
      <summary className="cursor-pointer underline">Cancel {name}&apos;s booking</summary>
      <div className="mt-2 flex flex-col gap-2">
        {!done && (
          <>
            <ReasonSelect
              id={`cancel-${shiftId}-${workerId}`}
              value={reason}
              onChange={setReason}
              forBooking
            />
            <button type="button" className={button} disabled={pending || !ready} onClick={cancel}>
              Yes, cancel {name}&apos;s booking
            </button>
          </>
        )}
        {message && (
          <p role="status" className="font-semibold">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
