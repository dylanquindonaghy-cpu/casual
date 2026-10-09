"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { strikesEmailResultText } from "@/lib/office/settings-copy";
import { resultBox } from "../shifts/shift-tones";
import { saveStrikesEmailAction } from "./actions";

const failed = { status: "error" as const };

// The strikes team's email: "Save and send a link", or, while it isn't confirmed, "Send the link
// again". Waits for the page (docs/ui-design.md "Forms wait for the page").
export function StrikesEmailForm({
  address,
  confirmed,
}: {
  address: string | null;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(address ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const save = (to: string) =>
    startTransition(async () => {
      const result = await saveStrikesEmailAction(to).catch(() => failed);
      setMessage(strikesEmailResultText(result));
      if (["saved", "sent_again", "cleared"].includes(result.status)) router.refresh();
    });
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
    >
      <label className={labelStack}>
        Strikes team email
        <input
          type="email"
          autoComplete="off"
          className={`${field} w-full`}
          value={value}
          maxLength={254}
          onChange={(e) => setValue(e.target.value)}
          disabled={!ready}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={btn.primary} disabled={pending || !ready}>
          Save and send a link
        </button>
        {address && !confirmed && (
          <button
            type="button"
            className={btn.secondary}
            disabled={pending || !ready}
            onClick={() => save(address)}
          >
            Send the link again
          </button>
        )}
      </div>
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </form>
  );
}
