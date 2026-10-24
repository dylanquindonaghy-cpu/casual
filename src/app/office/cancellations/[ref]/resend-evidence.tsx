"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { resendEvidenceText } from "@/lib/office/evidence-copy";
import { resultBox } from "../../shifts/shift-tones";
import { resendEvidenceAction } from "./actions";

const failed = { status: "error" as const };

// "Resend evidence", shown on a record whose evidence email failed or is held up (it may have
// arrived, so it's only ever sent again by a person), with `note` saying which. Waits for the page
// (docs/ui-design.md "Forms wait for the page"). The page always renders it in the same place, so
// its answer stays on screen after the refresh that follows a resend, when the record no longer
// needs one (`note` null) and the heading and the button go.
export function ResendEvidence({
  assignmentId,
  note,
}: {
  assignmentId: string;
  note: { heading: string; text: string } | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  if (!note && !message) return null;
  const answer = message && (
    <p role="status" className={`${resultBox} self-start`}>
      {message}
    </p>
  );
  if (!note) return <div className="mb-6 flex max-w-3xl flex-col">{answer}</div>;
  return (
    <section aria-labelledby="evidence" className="mb-6 flex max-w-3xl flex-col gap-2">
      <h2 id="evidence" className="font-bold text-ink">
        {note.heading}
      </h2>
      <p className="text-ink-muted">{note.text}</p>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className={`${btn.secondary} self-start`}
          disabled={pending || !ready}
          onClick={() =>
            startTransition(async () => {
              const result = await resendEvidenceAction(assignmentId).catch(() => failed);
              setMessage(resendEvidenceText(result));
              if (result.status === "queued") router.refresh();
            })
          }
        >
          Resend evidence
        </button>
        {answer}
      </div>
    </section>
  );
}
