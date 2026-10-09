"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { resendEvidenceText } from "@/lib/office/evidence-copy";
import { resultBox } from "../../shifts/shift-tones";
import { resendEvidenceAction } from "./actions";

const failed = { status: "error" as const };

// "Resend evidence", shown on a record whose evidence email failed (it may have arrived, so it's
// only ever sent again by a person). Waits for the page (docs/ui-design.md "Forms wait for the
// page").
export function ResendEvidence({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  return (
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
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </div>
  );
}
