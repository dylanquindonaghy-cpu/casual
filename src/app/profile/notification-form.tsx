"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/portal/profile-kinds";
import { saveNotificationSettingsAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";

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
    <div className="mt-3 space-y-3">
      <fieldset>
        <legend className="font-semibold">Send shift messages by</legend>
        {CHANNELS.map((c) => (
          <label key={c} className="flex min-h-12 items-center gap-3 py-2">
            <input
              type="radio"
              name="channel"
              value={c}
              checked={channel === c}
              onChange={() => setChannel(c)}
              className="h-6 w-6"
            />
            <span>{CHANNEL_LABELS[c]}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-12 items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={offerAlerts}
          onChange={(e) => setOfferAlerts(e.target.checked)}
          className="h-6 w-6"
        />
        <span>Tell me about open shifts</span>
      </label>
      <p className="text-base text-slate-600">
        Login links and codes always come to you when you ask for them.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        Save settings
      </button>
      {message && (
        <div
          role={message.alert ? "alert" : "status"}
          className={message.alert ? "text-red-700" : ""}
        >
          <p>{message.text}</p>
          {!message.alert && <p className="mt-1 text-base">— {signOff}</p>}
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
