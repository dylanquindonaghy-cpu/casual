"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  KIND_LABELS,
  MAX_REQUEST_NOTE,
  MAX_SWAP_WITH,
  requestPayload,
  WORKER_REQUEST_KINDS,
  type CreateRequestOutcome,
  type WorkerRequestKind,
} from "@/lib/portal/request-kinds";
import { createRequestAction } from "../actions";
import { RequestResult } from "../request-result";

type Shown = Exclude<CreateRequestOutcome, { status: "logged_out" }>;

const field = "mt-1 block w-full rounded-lg border-2 border-slate-300 px-3 py-3";

// New request: which shift, what kind (change the times, or swap), a short form, "Send request".
// The answer replaces the form.
export function RequestForm({
  shifts,
  preselected,
}: {
  shifts: { shiftId: string; label: string }[];
  preselected: string | null;
}) {
  const router = useRouter();
  const [shiftId, setShiftId] = useState(preselected ?? shifts[0]?.shiftId ?? "");
  const [kind, setKind] = useState<WorkerRequestKind | "">("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const set = (name: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [name]: e.target.value }));

  const send = () => {
    if (sending.current) return;
    if (!shiftId) return setProblem("Choose a shift.");
    if (!kind) return setProblem("Choose what you'd like to change.");
    if (kind === "time_change" && (!fields.start || !fields.end)) {
      return setProblem("Enter the start and finish times you'd like.");
    }
    if (kind === "time_change" && fields.start === fields.end) {
      return setProblem("The new start and finish must be different.");
    }
    if (!requestPayload(kind, fields)) return setProblem("Check the times and try again.");
    setProblem(null);
    sending.current = true;
    startTransition(async () => {
      const result = await createRequestAction(shiftId, kind, fields).catch(() => ({
        status: "error" as const,
      }));
      sending.current = false;
      if (result.status === "logged_out") router.replace("/login");
      else setOutcome(result);
    });
  };

  if (outcome && outcome.status !== "invalid" && outcome.status !== "error") {
    return <RequestResult outcome={outcome} />;
  }
  return (
    <div className="mt-6 space-y-4">
      {shifts.length > 1 || !preselected ? (
        <label className="block">
          <span className="font-semibold">Which shift?</span>
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={field}>
            {shifts.map((s) => (
              <option key={s.shiftId} value={s.shiftId}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="font-semibold">{shifts.find((s) => s.shiftId === shiftId)?.label}</p>
      )}
      <fieldset>
        <legend className="font-semibold">What would you like?</legend>
        {WORKER_REQUEST_KINDS.map((k) => (
          <label key={k} className="flex min-h-12 items-center gap-3 py-3">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="h-6 w-6"
            />
            <span>{KIND_LABELS[k]}</span>
          </label>
        ))}
      </fieldset>
      {kind === "time_change" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-semibold">New start</span>
            <input
              type="time"
              value={fields.start ?? ""}
              onChange={set("start")}
              className={field}
            />
          </label>
          <label className="block">
            <span className="font-semibold">New finish</span>
            <input type="time" value={fields.end ?? ""} onChange={set("end")} className={field} />
          </label>
        </div>
      )}
      {kind === "swap" && (
        <label className="block">
          <span className="font-semibold">Who could take it? (optional)</span>
          <input
            type="text"
            value={fields.swapWith ?? ""}
            maxLength={MAX_SWAP_WITH}
            onChange={set("swapWith")}
            className={field}
          />
        </label>
      )}
      {kind && (
        <label className="block">
          <span className="font-semibold">Anything else the office should know? (optional)</span>
          <textarea
            value={fields.note ?? ""}
            maxLength={MAX_REQUEST_NOTE}
            onChange={set("note")}
            rows={3}
            className={field}
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="text-red-700">
          {problem}
        </p>
      )}
      {outcome && <RequestResult outcome={outcome} />}
      <button
        type="button"
        disabled={pending}
        onClick={send}
        className="w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send request"}
      </button>
    </div>
  );
}
