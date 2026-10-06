"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resultBox } from "@/app/office/shifts/shift-tones";
import { btn, card, hint, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { WEB_IMPORT_MAX_BYTES } from "@/lib/office/import-limits";
import { payImportLines } from "@/lib/office/pay-import-copy";
import { importPayAction } from "./actions";

// Choose a file → "Check the file" (nothing saved) → "Import these pay records" (the same file).
// One card, laid out like the shifts import's (src/app/office/shifts/import/import-form.tsx), with
// the same answer box as the shift forms. The next step is always the dark button: "Check the
// file" until a check finds something to import, then "Import these pay records", then "Go to pay
// queries". Until a file is chosen, "Check the file" can't be pressed, and the line under it says
// why. The file field and the buttons wait for the page (docs/ui-design.md "Forms wait for the
// page"): a file chosen before then would be lost.
export function PayImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [checked, setChecked] = useState(false); // a check that found something to import
  const [imported, setImported] = useState(false);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

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
      const result = await importPayAction(form).catch(() => ({ status: "error" as const }));
      setLines(payImportLines(result));
      const done = result.status === "done" ? result.result : null;
      setChecked(mode === "check" && !!done && done.created + done.updated > 0);
      setImported(mode === "import" && !!done);
    });
  };

  return (
    <div className={`${card} flex flex-col items-start gap-4`}>
      <label className={`${labelStack} w-full`}>
        <span>Your file (.csv or .xlsx)</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={!hydrated}
          className="w-full max-w-full text-base font-normal text-ink"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setLines([]);
            setChecked(false);
            setImported(false);
          }}
        />
      </label>
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          className={checked || imported ? btn.secondary : btn.primary}
          disabled={pending || !file || !hydrated}
          aria-describedby={file ? undefined : "pay-import-choose-first"}
          onClick={() => send("check")}
        >
          Check the file
        </button>
        {!file && (
          <p id="pay-import-choose-first" className={hint}>
            Choose a file first.
          </p>
        )}
      </div>
      {lines.length > 0 && (
        <div role="status" className={`${resultBox} w-full`}>
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
      {checked && !imported && (
        <button
          type="button"
          className={btn.primary}
          disabled={pending || !hydrated}
          onClick={() => send("import")}
        >
          Import these pay records
        </button>
      )}
      {imported && (
        <Link href="/office/pay-queries" className={btn.primary}>
          Go to pay queries
        </Link>
      )}
    </div>
  );
}
