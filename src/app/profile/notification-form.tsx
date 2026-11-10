"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { label, muted, staffBtn, staffChoice } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@/lib/portal/profile-kinds";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { saveNotificationSettingsAction } from "./actions";
import { tryAgainText } from "@/lib/portal/copy";
import type { LoginWay } from "@/lib/portal/login-way";
import { EmailText } from "./email-text";
import { OfficeLinked } from "./office-link";

// How we reach you when a notification on their phone can't (Phase 26.9; decision 4): a text, or an
// email (offered only while the firm holds their address), and whether to hear about open shifts.
// With no text sender (P2.7) there's no channel to choose: it says how messages come instead (a
// push, else an email: src/lib/notify/send.ts deliverToWorker). Where the firm has phone
// notifications off (`push` false, 28.11), nothing says they'd come. The choices are choice cards
// and the answer a slip (28.11); the email address sits on its own line, breaking only after its @
// or a dot.
export function NotificationForm({
  channel: initialChannel,
  offerAlerts: initialAlerts,
  textsOff,
  loginWay,
  textSender: textSenderProp,
  push = true,
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
  // Whether the firm has phone notifications (its VAPID key; Profile passes it).
  push?: boolean;
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
      if (result.status === "logged_out") return router.replace(LOGIN_AGAIN);
      setMessage(
        result.status === "saved"
          ? {
              text: savedText(channel, offerAlerts, textsOff, textSender, email, push),
              alert: false,
            }
          : { text: tryAgainText(), alert: true },
      );
      // The fold's own line ("Open-shift alerts on") follows what was saved.
      if (result.status === "saved") router.refresh();
    });

  return (
    <div className="mt-4">
      {textSender ? (
        <fieldset>
          <legend className={label}>If we can&apos;t reach this phone, send my messages by</legend>
          <div className="mt-2 space-y-2">
            {CHANNELS.filter((c) => c !== "email" || email).map((c) => (
              <label key={c} className={staffChoice}>
                <input
                  type="radio"
                  name="channel"
                  value={c}
                  checked={channel === c}
                  onChange={() => setChannel(c)}
                  disabled={!ready}
                  className="h-6 w-6 shrink-0 accent-ink"
                />
                <span className="min-w-0">
                  {CHANNEL_LABELS[c]}
                  {c === "email" && email && (
                    <EmailText email={email} className="block font-normal text-ink-muted" />
                  )}
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
      ) : push ? (
        <p>
          Shift messages come as notifications on this phone, if you turn them on below.{" "}
          {email ? (
            <>
              If not, we email:
              <EmailText email={email} className="block font-semibold" />
            </>
          ) : (
            "We have no email address for you. To add one, ask the office."
          )}
        </p>
      ) : email ? (
        <p>
          We email shift messages to:
          <EmailText email={email} className="block font-semibold" />
        </p>
      ) : (
        <p>
          <OfficeLinked text={NO_WAY_TEXT} />
        </p>
      )}
      <label className={`${staffChoice} mt-4`}>
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
        <Slip
          tone={message.alert ? "urgent" : "done"}
          role={message.alert ? "alert" : "status"}
          className="mt-3"
        >
          <p>{message.text}</p>
          {!message.alert && <p className={muted}>— {signOff}</p>}
        </Slip>
      )}
    </div>
  );
}

// No text sender, no phone notifications and no address: nothing can carry a shift message
// (28.11).
export const NO_WAY_TEXT =
  "We have no email address for you, so we can't send you shift messages. To add one, message the office.";

// The confirmation says what was saved, and what will really happen: texts chosen while they're
// off (they replied STOP) go by email, if we hold their address, until START; with no address, by
// notifications on their phone, or not at all where the firm has those off (`push` false, 28.11)
// (exported for the tests).
export function savedText(
  channel: Channel,
  offerAlerts: boolean,
  textsOff = false,
  textSender = true,
  email: string | null = null,
  push = true,
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
          : push
            ? "Texts are off, so we can only reach you by notifications on your phone until you text START."
            : "Texts are off, so we can't send you shift messages until you text START."
        : "We'll send shift messages by text.";
  return `Saved. ${how} ${alerts}`;
}
