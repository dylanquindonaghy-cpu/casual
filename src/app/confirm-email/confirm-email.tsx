"use client";

import { useEffect, useState, useTransition } from "react";
import { staffBtn } from "@/app/ui/classes";
import { confirmResultText } from "@/lib/office/settings-copy";
import { confirmStrikesEmailAction } from "./actions";

// The link is /confirm-email#<token>. The token stays in the fragment, which browsers never send
// to the server (nor a link checker that opens it); this reads it, clears it from the address bar,
// and sends it only when the button is pressed, so opening the link alone confirms nothing.
export function ConfirmEmail({ firmName }: { firmName: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    // Keep the first value read (React runs this twice in development).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken((previous) => previous ?? (fromHash || null));
  }, []);

  if (token === undefined) return null;
  if (token === null) {
    return (
      <p role="alert" className="mt-6 text-lg font-semibold">
        This link doesn&apos;t work. Open the whole link from the email.
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-col gap-4">
      <p>
        {firmName} asked to send records of late cancellations to this email address. Confirm it
        only if that&apos;s right.
      </p>
      {message ? (
        <p role="status" className="text-lg font-semibold">
          {message}
        </p>
      ) : (
        <button
          type="button"
          className={staffBtn.primary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await confirmStrikesEmailAction(token).catch(() => ({
                status: "error" as const,
              }));
              setMessage(confirmResultText(result, firmName));
            })
          }
        >
          Confirm this address
        </button>
      )}
    </div>
  );
}
