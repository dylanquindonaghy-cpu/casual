"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { label, labelStack, nums, staffBtn, staffChoice, staffField } from "@/app/ui/classes";
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
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { createRequestAction } from "../actions";
import { RequestResult } from "../request-result";

type Shown = Exclude<CreateRequestOutcome, { status: "logged_out" }>;

// A shift to ask about (src/lib/portal/requests.ts RequestableShift): its two lines, "Sat 7 Nov,
// 14:00 to 22:00" then "Door supervisor at Demo Arena" in full; without them, its label on one.
type PickShift = { shiftId: string; label: string; when?: string; what?: string };

// A shift's words on its card (Phase 28.9: two lines, so the site's name is never cut off, as it was
// in a select).
function ShiftLines({ s }: { s: PickShift }) {
  if (!s.when || !s.what) return <span className={nums}>{s.label}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`font-semibold ${nums}`}>{s.when}</span>
      <span className="font-normal">{s.what}</span>
    </span>
  );
}

// New request: which shift (a choice card each, Phase 28.9), what kind (change the times, or swap),
// a short form, "Send request". The answer replaces the form. The fields and the button wait for
// the page (docs/ui-design.md "Forms wait for the page").
export function RequestForm({
  shifts,
  preselected,
}: {
  shifts: PickShift[];
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
      if (result.status === "logged_out") router.replace(LOGIN_AGAIN);
      else setOutcome(result);
    });
  };

  const chosen = shifts.find((s) => s.shiftId === shiftId);
  if (outcome && outcome.status !== "invalid" && outcome.status !== "error") {
    return <RequestResult outcome={outcome} />;
  }
  return (
    <div className="space-y-6">
      {shifts.length > 1 || !preselected ? (
        <fieldset>
          <legend className={label}>Which shift?</legend>
          <div className="mt-2 space-y-2">
            {shifts.map((s) => (
              <label key={s.shiftId} className={staffChoice}>
                <input
                  type="radio"
                  name="shift"
                  value={s.shiftId}
                  checked={shiftId === s.shiftId}
                  onChange={() => setShiftId(s.shiftId)}
                  disabled={!ready}
                  className="h-6 w-6 shrink-0 accent-ink"
                />
                <ShiftLines s={s} />
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="flex min-h-14 items-center rounded-row glass-tile px-4 py-3 text-base text-ink">
          {chosen && <ShiftLines s={chosen} />}
        </div>
      )}
      <fieldset>
        <legend className={label}>What would you like?</legend>
        <div className="mt-2 space-y-2">
          {WORKER_REQUEST_KINDS.map((k) => (
            <label key={k} className={staffChoice}>
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
