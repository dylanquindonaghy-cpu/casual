"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { label, muted, staffBtn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/portal/profile-kinds";
import { saveNotificationSettingsAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

// One answer to pick from, as a big bordered row; the picked one is outlined in ink.
const choice =
  "flex min-h-14 items-center gap-3 rounded-xl border-2 border-line-strong bg-white px-4 py-3 has-checked:border-ink has-checked:bg-quiet-soft";

// How we reach you: WhatsApp or text message, and whether to hear about open shifts.
export function NotificationForm({
  channel: initialChannel,
  offerAlerts: initialAlerts,
  textsOff,
  signOff,
}: {
  channel: Channel;
  offerAlerts: boolean;
  textsOff: boolean; // they replied STOP to a text: no texts until START
  signOff: string;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [offerAlerts, setOfferAlerts] = useState(initialAlerts);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  // The choices and the button wait for the page (docs/ui-design.md "Forms wait for the page").
  const ready = useHydrated();

  const save = () =>
    startTransition(async () => {
      const result = await saveNotificationSettingsAction(channel, offerAlerts).catch(() => ({
        status: "error" as const,
      }));
      if (result.status === "logged_out") return router.replace("/login");
      setMessage(
        result.status === "saved"
          ? { text: savedText(channel, offerAlerts, textsOff), alert: false }
          : { text: tryAgainText(), alert: true },
      );
    });

  return (
    <div className="mt-4">
      <fieldset>
        <legend className={label}>Send shift messages by</legend>
        <div className="mt-2 space-y-2">
          {CHANNELS.map((c) => (
            <label key={c} className={choice}>
              <input
                type="radio"
                name="channel"
                value={c}
                checked={channel === c}
                onChange={() => setChannel(c)}
                disabled={!ready}
                className="h-6 w-6 shrink-0 accent-ink"
              />
              <span>{CHANNEL_LABELS[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={`${choice} mt-4`}>
        <input
          type="checkbox"
          checked={offerAlerts}
          onChange={(e) => setOfferAlerts(e.target.checked)}
          disabled={!ready}
          className="h-6 w-6 shrink-0 accent-ink"
        />
        <span>Tell me about open shifts</span>
      </label>
      <p className={`mt-2 ${muted}`}>
        Login links and codes always come to you when you ask for them.
      </p>
      <button
        type="button"
        disabled={pending || !ready}
        onClick={save}
        className={`${staffBtn.primary} mt-4`}
      >
        Save settings
      </button>
      {message && (
        <div
          role={message.alert ? "alert" : "status"}
          className={`mt-3 rounded-xl border-2 p-3 ${message.alert ? "border-urgent bg-urgent-soft font-semibold text-urgent-ink" : "border-done bg-done-soft"}`}
        >
          <p>{message.text}</p>
          {!message.alert && <p className={`mt-1 ${muted}`}>— {signOff}</p>}
        </div>
      )}
    </div>
  );
}

// The confirmation says what was saved, and what will really happen: texts chosen while they're
// off (they replied STOP) go by WhatsApp until START (exported for the tests).
export function savedText(channel: Channel, offerAlerts: boolean, textsOff = false): string {
  const how =
    channel === "sms" && textsOff
      ? "Texts are off, so we'll send shift messages by WhatsApp until you text START."
      : `We'll send shift messages by ${channel === "sms" ? "text message" : "WhatsApp"}.`;
  return `Saved. ${how} ${
    offerAlerts ? "We'll tell you about open shifts." : "We won't tell you about open shifts."
  }`;
}
