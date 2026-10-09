"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { sitePostcodeResultText } from "@/lib/office/settings-copy";
import { resultBox } from "../shifts/shift-tones";
import { editSitePostcodeAction } from "./actions";

const failed = { status: "error" as const };

// One site's postcode: "Save postcode" (looked up first: one it can't find saves nothing). Refused
// while booked sessions to come use the site.
export function SitePostcodeForm({
  siteId,
  name,
  postcode,
}: {
  siteId: string;
  name: string;
  postcode: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(postcode ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await editSitePostcodeAction(siteId, value).catch(() => failed);
          setMessage(sitePostcodeResultText(result));
          if (result.status === "saved" || result.status === "located") router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelStack}>
          Postcode
          <input
            className={`${field} w-36 uppercase`}
            value={value}
            maxLength={12}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            disabled={!ready}
          />
        </label>
        <button
          type="submit"
          className={btn.secondary}
          aria-label={`Save postcode: ${name}`}
          disabled={pending || !ready}
        >
          Save postcode
        </button>
      </div>
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </form>
  );
}
