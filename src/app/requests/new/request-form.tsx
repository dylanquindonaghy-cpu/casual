"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { label, labelStack, staffBtn, staffField } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
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

// One answer to pick from, as a big bordered row; the picked one is outlined in ink.
const choice =
  "flex min-h-14 items-center gap-3 rounded-xl border-2 border-line-strong bg-card px-4 py-3 font-normal has-checked:border-ink has-checked:bg-quiet-soft";

// New request: which shift, what kind (change the times, or swap), a short form, "Send request".
// The answer replaces the form. The fields and the button wait for the page (docs/ui-design.md
// "Forms wait for the page").
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
  const ready = useHydrated();
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
    <div className="space-y-6">
      {shifts.length > 1 || !preselected ? (
        <label className={labelStack}>
          <span>Which shift?</span>
          <select
            value={shiftId}
            onChange={(e) => setShiftId(e.target.value)}
            disabled={!ready}
            className={staffField}
          >
            {shifts.map((s) => (
              <option key={s.shiftId} value={s.shiftId}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="rounded-xl border border-line bg-quiet-soft p-4 font-semibold tabular-nums">
          {shifts.find((s) => s.shiftId === shiftId)?.label}
        </p>
      )}
      <fieldset>
        <legend className={label}>What would you like?</legend>
        <div className="mt-2 space-y-2">
          {WORKER_REQUEST_KINDS.map((k) => (
            <label key={k} className={choice}>
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                disabled={!ready}
                className="h-6 w-6 shrink-0 accent-ink"
              />
              <span>{KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "time_change" && (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelStack}>
            <span>New start</span>
            <input
              type="time"
              value={fields.start ?? ""}
              onChange={set("start")}
              disabled={!ready}
              className={`${staffField} tabular-nums`}
            />
          </label>
          <label className={labelStack}>
            <span>New finish</span>
            <input
              type="time"
              value={fields.end ?? ""}
              onChange={set("end")}
              disabled={!ready}
              className={`${staffField} tabular-nums`}
            />
          </label>
        </div>
      )}
      {kind === "swap" && (
        <label className={labelStack}>
          <span>Who could take it? (optional)</span>
          <input
            type="text"
            value={fields.swapWith ?? ""}
            maxLength={MAX_SWAP_WITH}
            onChange={set("swapWith")}
            disabled={!ready}
            className={staffField}
          />
        </label>
      )}
      {kind && (
        <label className={labelStack}>
          <span>Anything else the office should know? (optional)</span>
          <textarea
            value={fields.note ?? ""}
            maxLength={MAX_REQUEST_NOTE}
            onChange={set("note")}
            disabled={!ready}
            rows={3}
            className={staffField}
          />
        </label>
      )}
      {problem && (
        <p role="alert" className="font-semibold text-urgent">
          {problem}
        </p>
      )}
      {outcome && <RequestResult outcome={outcome} />}
      <button
        type="button"
        disabled={pending || !ready}
        onClick={send}
        className={staffBtn.primary}
      >
        {pending ? "Sending…" : "Send request"}
      </button>
    </div>
  );
}
