"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, codeBox, confirmStep, field, hint, labelStack, notice, nums } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import {
  addWebhookResultText,
  removeWebhookQuestion,
  removeWebhookResultText,
  renewSecretQuestion,
  renewSecretResultText,
  SECRET_SHOWN_ONCE,
  testWebhookResultText,
} from "@/lib/office/integrations-copy";
import { resultBox } from "../../shifts/shift-tones";
import {
  addWebhookAction,
  removeWebhookAction,
  renewSigningSecretAction,
  sendTestWebhookAction,
} from "./actions";

// The request itself failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };

// The signing secret, shown once, here only: gone on reload (it's never stored).
function SecretShownOnce({ secret, onHide }: { secret: string; onHide: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = () => {
    const done = () => setCopied("Copied.");
    const refused = () => setCopied("We couldn't copy it. Select the secret and copy it yourself.");
    if (!navigator.clipboard) return refused();
    navigator.clipboard.writeText(secret).then(done, refused);
  };
  return (
    <div className={notice}>
      <p className="font-semibold">Signing secret:</p>
      <code className={`${codeBox} mt-2`}>{secret}</code>
      <p role="status" className="mt-2 font-semibold">
        {SECRET_SHOWN_ONCE}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={btn.secondary} onClick={copy}>
          Copy the secret
        </button>
        <button type="button" className={btn.secondary} onClick={onHide}>
          Hide the secret
        </button>
      </div>
      {copied && (
        <p role="status" className="mt-2 font-semibold">
          {copied}
        </p>
      )}
    </div>
  );
}

// "Add a webhook" (no address yet), or the address with its status and its three buttons.
export function WebhookPanel({
  hint: addressHint,
  status,
}: {
  hint: string | null;
  status: string;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"remove" | "renew" | null>(null);
  const hintId = useId();
  const off = !ready || pending;

  const showSecret = (s: string | null, text: string) => {
    setSecret(s);
    setMessage(s ? null : text);
    router.refresh();
  };

  if (!addressHint) {
    return (
      <div className="flex flex-col gap-4">
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await addWebhookAction(address).catch(() => failed);
              if (result.status === "added") {
                setAddress("");
                showSecret(result.secret, "");
              } else {
                showSecret(null, addWebhookResultText(result));
              }
            });
          }}
        >
          <label className={labelStack}>
            Address
            <input
              className={`${field} w-full`}
              type="url"
              inputMode="url"
              value={address}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              aria-describedby={hintId}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!ready}
            />
          </label>
          <p id={hintId} className={hint}>
            The https address your planner gives you for webhooks. Keep it secret, like a password.
          </p>
          <button type="submit" className={`${btn.primary} self-start`} disabled={off}>
            Add a webhook
          </button>
        </form>
        {message && (
          <p role="status" className={`${resultBox} self-start`}>
            {message}
          </p>
        )}
        {secret && <SecretShownOnce secret={secret} onHide={() => setSecret(null)} />}
      </div>
    );
  }

  const renew = () =>
    startTransition(async () => {
      const result = await renewSigningSecretAction().catch(() => failed);
      setConfirming(null);
      showSecret(result.status === "renewed" ? result.secret : null, renewSecretResultText(result));
    });
  const remove = () =>
    startTransition(async () => {
      const result = await removeWebhookAction().catch(() => failed);
      setConfirming(null);
      setSecret(null);
      setMessage(removeWebhookResultText(result));
      router.refresh();
    });
  const test = () =>
    startTransition(async () => {
      const result = await sendTestWebhookAction().catch(() => failed);
      setMessage(testWebhookResultText(result));
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-semibold">Address</dt>
        <dd className="font-mono break-all">{addressHint}</dd>
        <dt className="font-semibold">Status</dt>
        <dd className={nums}>{status}</dd>
      </dl>
      {confirming ? (
        <div className={confirmStep}>
          <p className="text-urgent-ink">
            {confirming === "remove" ? removeWebhookQuestion : renewSecretQuestion}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={btn.dangerSolid}
              disabled={off}
              onClick={confirming === "remove" ? remove : renew}
            >
              {confirming === "remove" ? "Yes, remove it" : "Yes, make a new secret"}
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={off}
              onClick={() => setConfirming(null)}
            >
              {confirming === "remove" ? "Keep it" : "Keep the old secret"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={btn.secondary} disabled={off} onClick={test}>
            Send test event
          </button>
          <button
            type="button"
            className={btn.secondary}
            disabled={off}
            onClick={() => {
              setMessage(null);
              setConfirming("renew");
            }}
          >
            New signing secret
          </button>
          <button
            type="button"
            className={btn.danger}
            disabled={off}
            onClick={() => {
              setMessage(null);
              setConfirming("remove");
            }}
          >
            Remove
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
      {secret && <SecretShownOnce secret={secret} onHide={() => setSecret(null)} />}
    </div>
  );
}
