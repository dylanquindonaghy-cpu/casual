"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { NOTE_HINT, noteResultText } from "@/lib/office/follow-up-copy";
import { btn, field, hint, labelStack } from "../../../ui/classes";
import { addNoteAction } from "../actions";

// "Add a note" on a casual's page (Phase 26.7, cas-4): the office's words, kept with them (never in
// the log), up to 500 characters, no phone numbers or email addresses. The server checks it all.
export function NoteForm({ workerId }: { workerId: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const r = await addNoteAction(workerId, note).catch(() => ({ status: "error" as const }));
      setSaid(noteResultText(r));
      if (r.status === "added") {
        setNote("");
        router.refresh();
      }
    });
  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className={labelStack}>
        Add a note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          disabled={!ready}
          aria-describedby={`note-hint-${workerId}`}
          className={`${field} w-full`}
        />
      </label>
      <p id={`note-hint-${workerId}`} className={hint}>
        {NOTE_HINT}
      </p>
      <button
        type="button"
        onClick={save}
        disabled={pending || !ready || note.trim() === ""}
        className={`${btn.secondary} self-start`}
      >
        Save note
      </button>
      <p role="status" className={said ? "text-sm text-ink-muted" : "sr-only"}>
        {said ?? ""}
      </p>
    </div>
  );
}
