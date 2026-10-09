"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { sendNowText } from "@/lib/office/pay-digest-copy";
import { sendDigestNowAction } from "./actions";

const failed = { status: "error" as const };

// Sends the new pay queries to payroll now, rather than waiting for the digest time.
export function SendDigestButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const send = () =>
    startTransition(async () => {
      const result = await sendDigestNowAction().catch(() => failed);
      setMessage(sendNowText(result));
      if (result.status === "queued") router.refresh();
    });
  return (
    <div className="flex max-w-prose flex-col items-start gap-3">
      <button type="button" className={btn.secondary} disabled={pending || !ready} onClick={send}>
        Send the digest now
      </button>
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
