"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, card, field, hint, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import type { CreateShiftsResult } from "@/lib/office/shift-editor";
import { createProblems, createResultText } from "@/lib/office/shifts-copy";
import { resultBox } from "./shift-tones";
import { createShiftsAction } from "./actions";

const input = `${field} w-full`;
const MAX_LINES = 12;

type Line = { role: string; start: string; end: string; headcount: string };
const emptyLine = (): Line => ({ role: "", start: "", end: "", headcount: "1" });

// "New shift" (one line) or "Shifts for an event" (one date and site, several lines). Nothing is
// saved unless every line is right; problems say which line. Each line is a <fieldset> (the
// browser tests find the lines as groups, in order), its fields side by side on a wide screen.
// The fields and buttons wait for the page (docs/ui-design.md "Forms wait for the page"): a date
// typed before then would be put back to today.
export function ShiftCreateForm({
  mode,
  sites,
  roles,
  today,
}: {
  mode: "single" | "event";
  sites: { id: string; name: string }[];
  roles: string[];
  today: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [siteId, setSiteId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [lines, setLines] = useState<Line[]>(
    mode === "single" ? [emptyLine()] : Array.from({ length: 4 }, emptyLine),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = () =>
    startTransition(async () => {
      const result: CreateShiftsResult | { status: "logged_out" | "not_allowed" | "error" } =
        await createShiftsAction({ date, siteId, instructions, lines }).catch(() => ({
          status: "error" as const,
        }));
      setMessage(createResultText(result));
      setProblems(result.status === "invalid" ? createProblems(result) : []);
      if (result.status === "created") {
        if (mode === "single" && result.shiftIds[0]) {
          router.push(`/office/shifts/${result.shiftIds[0]}`);
        } else {
          setCreated(result.shiftIds);
          setLines(Array.from({ length: 4 }, emptyLine));
        }
      }
    });

  return (
    <form
      className={`${card} flex flex-col gap-6 sm:p-6`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelStack}>
          Date
          <input
            type="date"
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!ready}
          />
        </label>
        <label className={labelStack}>
          Site
          <select
            className={input}
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
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
      <datalist id="roles">
        {roles.map((r) => (
          <option key={r} value={r.replace(/_/g, " ")} />
        ))}
      </datalist>
      <div className="flex flex-col gap-4">
        {lines.map((l, i) => (
          <fieldset
            key={i}
            className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line bg-canvas p-4 pt-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_6rem]"
          >
            <legend className="float-left col-span-2 font-semibold text-ink sm:col-span-4">
              {mode === "single" ? "The shift" : `Line ${i + 1}`}
            </legend>
            <label className={`${labelStack} col-span-2 sm:col-span-1`}>
              <span>Role</span>
              <input
                className={input}
                list="roles"
                value={l.role}
                onChange={(e) => setLine(i, { role: e.target.value })}
                disabled={!ready}
              />
            </label>
            <label className={labelStack}>
              <span>Start</span>
              <input
                type="time"
                className={input}
                value={l.start}
                onChange={(e) => setLine(i, { start: e.target.value })}
                disabled={!ready}
              />
            </label>
            <label className={labelStack}>
              <span>Finish</span>
              <input
                type="time"
                className={input}
                value={l.end}
                onChange={(e) => setLine(i, { end: e.target.value })}
                disabled={!ready}
              />
            </label>
            <label className={labelStack}>
              <span>Places</span>
              <input
                type="number"
                min={1}
                max={1000}
                className={input}
                value={l.headcount}
                onChange={(e) => setLine(i, { headcount: e.target.value })}
                disabled={!ready}
              />
            </label>
          </fieldset>
        ))}
        {mode === "event" && lines.length < MAX_LINES && (
          <button
            type="button"
            className={`${btn.secondary} self-start`}
            disabled={!ready}
            onClick={() => setLines((all) => [...all, emptyLine()])}
          >
            Add another line
          </button>
        )}
        <p className={hint}>A finish before the start is the next morning.</p>
      </div>
      <label className={labelStack}>
        Instructions (optional)
        <textarea
          className={input}
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={!ready}
        />
      </label>
      <button type="submit" className={`${btn.primary} self-start`} disabled={pending || !ready}>
        {mode === "single" ? "Create shift" : "Create these shifts"}
      </button>
      {message && (
        <div role="status" className={resultBox}>
          <p>{message}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc pl-6 font-normal">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {created.length > 0 && (
            <Link href="/office/shifts" className={btn.link}>
              See the shifts
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
