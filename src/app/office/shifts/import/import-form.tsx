"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { WEB_IMPORT_MAX_BYTES } from "@/lib/office/import-limits";
import { importResultLines } from "@/lib/office/shifts-copy";
import { importShiftsAction } from "../actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";

// Choose a file → "Check the file" (nothing saved) → "Import these shifts" (the same file).
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [checked, setChecked] = useState(false); // a check that found something to import
  const [imported, setImported] = useState(false);
  const [pending, startTransition] = useTransition();

  const send = (mode: "check" | "import") => {
    if (!file) return setLines(["Choose a file first."]);
    if (file.size > WEB_IMPORT_MAX_BYTES) {
      return setLines([
        "The file is too big for the web (1 MB at most). Split it into smaller files.",
      ]);
    }
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    startTransition(async () => {
      const result = await importShiftsAction(form).catch(() => ({ status: "error" as const }));
      setLines(importResultLines(result));
      const done = result.status === "done" ? result.result : null;
      setChecked(mode === "check" && !!done && done.created + done.updated > 0);
      setImported(mode === "import" && !!done);
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col">
        <span className="font-semibold">Your file (.csv or .xlsx)</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setLines([]);
            setChecked(false);
            setImported(false);
          }}
        />
      </label>
      <button
        type="button"
        className={button}
        disabled={pending || !file}
        onClick={() => send("check")}
      >
        Check the file
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
      {checked && !imported && (
        <button type="button" className={button} disabled={pending} onClick={() => send("import")}>
          Import these shifts
        </button>
      )}
      {imported && (
        <Link href="/office/shifts" className="underline">
          See the shifts
        </Link>
      )}
    </div>
  );
}
