"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CreateShiftsResult } from "@/lib/office/shift-editor";
import { createProblems, createResultText } from "@/lib/office/shifts-copy";
import { createShiftsAction } from "./actions";

const input = "rounded border border-slate-400 px-2 py-1";
const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const MAX_LINES = 12;

type Line = { role: string; start: string; end: string; headcount: string };
const emptyLine = (): Line => ({ role: "", start: "", end: "", headcount: "1" });

// "New shift" (one line) or "Shifts for an event" (one date and site, several lines). Nothing is
// saved unless every line is right; problems say which line.
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
      className="mt-6 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col">
        <span className="font-semibold">Date</span>
        <input
          type="date"
          className={input}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="font-semibold">Site</span>
        <select className={input} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">No site</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <datalist id="roles">
        {roles.map((r) => (
          <option key={r} value={r.replace(/_/g, " ")} />
        ))}
      </datalist>
      {lines.map((l, i) => (
        <fieldset key={i} className="flex flex-wrap gap-3 rounded-lg border border-slate-300 p-3">
          <legend className="font-semibold">
            {mode === "single" ? "The shift" : `Line ${i + 1}`}
          </legend>
          <label className="flex flex-col">
            <span>Role</span>
            <input
              className={input}
              list="roles"
              value={l.role}
              onChange={(e) => setLine(i, { role: e.target.value })}
            />
          </label>
          <label className="flex flex-col">
            <span>Start</span>
            <input
              type="time"
              className={input}
              value={l.start}
              onChange={(e) => setLine(i, { start: e.target.value })}
            />
          </label>
          <label className="flex flex-col">
            <span>Finish</span>
            <input
              type="time"
              className={input}
              value={l.end}
              onChange={(e) => setLine(i, { end: e.target.value })}
            />
          </label>
          <label className="flex flex-col">
            <span>Places</span>
            <input
              type="number"
              min={1}
              max={1000}
              className={`${input} w-24`}
              value={l.headcount}
              onChange={(e) => setLine(i, { headcount: e.target.value })}
            />
          </label>
        </fieldset>
      ))}
      {mode === "event" && lines.length < MAX_LINES && (
        <button
          type="button"
          className={button}
          onClick={() => setLines((all) => [...all, emptyLine()])}
        >
          Add another line
        </button>
      )}
      <p>A finish before the start is the next morning.</p>
      <label className="flex flex-col">
        <span className="font-semibold">Instructions (optional)</span>
        <textarea
          className={input}
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      <button type="submit" className={button} disabled={pending}>
        {mode === "single" ? "Create shift" : "Create these shifts"}
      </button>
      {message && (
        <div role="status">
          <p className="font-semibold">{message}</p>
          {problems.length > 0 && (
            <ul className="list-disc pl-6">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {created.length > 0 && (
            <Link href="/office/shifts" className="underline">
              See the shifts
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
