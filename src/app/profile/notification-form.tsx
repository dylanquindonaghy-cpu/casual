"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { label, muted, staffBtn } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/portal/profile-kinds";
import { saveNotificationSettingsAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import type { LoginWay } from "@/lib/portal/login-way";

// One answer to pick from, as a big bordered row; the picked one is outlined in ink.
const choice =
  "flex min-h-14 items-center gap-3 glass-tile rounded-2xl border-2 border-line-strong px-4 py-3 has-checked:border-ink has-checked:bg-active";

// How we reach you when a notification on their phone can't (Phase 26.9; decision 4): a text, or an
// email (offered only while the firm holds their address), and whether to hear about open shifts.
// With no text sender (P2.7) there's no channel to choose: it says how messages come instead (a
// push, else an email: src/lib/notify/send.ts deliverToWorker).
export function NotificationForm({
  channel: initialChannel,
  offerAlerts: initialAlerts,
  textsOff,
  loginWay,
  textSender: textSenderProp,
  email,
  signOff,
}: {
  channel: Channel;
  offerAlerts: boolean;
  textsOff: boolean; // they replied STOP to a text: no texts until START
  // How their login links and codes go (src/lib/portal/login-way.ts): "message" only while there's
  // a text sender.
  loginWay: LoginWay;
  // Whether texts exist at all (Profile passes it; else the login way says): the choice shows even
  // for a casual who replied STOP (Phase 26.9).
  textSender?: boolean;
  email: string | null;
  signOff: string;
}) {
  const textSender = textSenderProp ?? loginWay === "message";
  const router = useRouter();
  // Email chosen, but the firm no longer holds their address: messages go by text (src/lib/notify/
  // send.ts), so that's what's ticked, and saving keeps it a text.
  const [channel, setChannel] = useState<Channel>(
    initialChannel === "email" && !email ? "sms" : initialChannel,
  );
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
          ? { text: savedText(channel, offerAlerts, textsOff, textSender, email), alert: false }
          : { text: tryAgainText(), alert: true },
      );
    });

  return (
    <div className="mt-4">
      {textSender ? (
        <fieldset>
          <legend className={label}>If we can&apos;t reach this phone, send my messages by</legend>
          <div className="mt-2 space-y-2">
            {CHANNELS.filter((c) => c !== "email" || email).map((c) => (
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
                <span className="min-w-0 break-all">
                  {c === "email" && email ? `${CHANNEL_LABELS[c]} (${email})` : CHANNEL_LABELS[c]}
                </span>
              </label>
            ))}
          </div>
          {!email && (
            <p className={`mt-2 ${muted}`}>
              To get them by email instead, ask the office to add your email address.
            </p>
          )}
        </fieldset>
      ) : (
        <p>
          Shift messages come as notifications on this phone, if you turn them on below.{" "}
          {email ? (
            <>
              If not, we email <span className="font-semibold break-all">{email}</span>.
            </>
          ) : (
            "We have no email address for you. To add one, ask the office."
          )}
        </p>
      )}
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
      {/* Not when nothing can carry them (no text sender, and email login off or no address). */}
      {loginWay !== "off" && (
        <p className={`mt-2 ${muted}`}>
          Login links and codes always come to you when you ask for them.
        </p>
      )}
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
// off (they replied STOP) go by email, if we hold their address, until START (exported for the
// tests).
export function savedText(
  channel: Channel,
  offerAlerts: boolean,
  textsOff = false,
  textSender = true,
  email: string | null = null,
): string {
  const alerts = offerAlerts
    ? "We'll tell you about open shifts."
    : "We won't tell you about open shifts.";
  if (!textSender) return `Saved. ${alerts}`;
  const how =
    channel === "email"
      ? "We'll send shift messages by email."
      : textsOff
        ? email
          ? "Texts are off, so we'll email shift messages until you text START."
          : "Texts are off, so we can only reach you by notifications on your phone until you text START."
        : "We'll send shift messages by text.";
  return `Saved. ${how} ${alerts}`;
}
