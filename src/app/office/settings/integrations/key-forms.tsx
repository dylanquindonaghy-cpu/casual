"use client";

import { useRouter } from "next/navigation";
import { Fragment, useId, useState, useTransition } from "react";
import { btn, card, confirmStep, field, hint, labelStack, nums, table } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import {
  createKeyResultText,
  KEY_SHOWN_ONCE,
  revokeKeyResultText,
  revokeQuestion,
} from "@/lib/office/integrations-copy";
import { resultBox } from "../../shifts/shift-tones";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

// The request itself failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };

// "Create a key": asks for a name, then shows the key once, here only. It is gone on reload (the
// server keeps only its hash), so it's shown with "Copy this key now. You won't see it again."
export function CreateKeyForm() {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const hintId = useId();
  const copy = (key: string) => {
    const done = () => setCopied("Copied.");
    const refused = () => setCopied("We couldn't copy it. Select the key and copy it yourself.");
    if (!navigator.clipboard) return refused();
    navigator.clipboard.writeText(key).then(done, refused);
  };
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await createApiKeyAction(name).catch(() => failed);
            setCopied(null);
            if (result.status === "created") {
              setMade({ key: result.key, label: result.label });
              setMessage(null);
              setName("");
              router.refresh();
            } else {
              setMade(null);
              setMessage(createKeyResultText(result));
              if (result.status === "unknown") router.refresh();
            }
          });
        }}
      >
        <label className={labelStack}>
          Name
          <input
            className={`${field} w-full`}
            value={name}
            maxLength={60}
            autoComplete="off"
            aria-describedby={hintId}
            onChange={(e) => setName(e.target.value)}
            disabled={!ready}
          />
        </label>
        <p id={hintId} className={hint}>
          Something you&apos;ll recognise, like your planner&apos;s name.
        </p>
        <button type="submit" className={`${btn.primary} self-start`} disabled={pending || !ready}>
          Create a key
        </button>
      </form>
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
      {made && (
        <div className="rounded-row border border-attention-line bg-attention-soft p-4 text-attention-ink shadow-soft">
          <p role="status" className="font-semibold">
            {KEY_SHOWN_ONCE}
          </p>
          <p className="mt-1">Your new key, {made.label}:</p>
          <code className="mt-2 block rounded-row border border-line bg-card px-3 py-2 font-mono text-base break-all text-ink select-all">
            {made.key}
          </code>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={btn.secondary} onClick={() => copy(made.key)}>
              Copy the key
            </button>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => {
                setMade(null);
                setCopied(null);
              }}
            >
              Hide the key
            </button>
          </div>
          {copied && (
            <p role="status" className="mt-2 font-semibold">
              {copied}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export interface KeyRowView {
  id: string;
  label: string;
  key: string; // "…k3F9"
  created: string; // "Sam Rota, 09:41 on Mon 2 Nov"
  lastUsed: string; // "09:41", "Sat 7 Nov, 09:41" or "Never"
}

// The live keys: a table from 768px, stacked cards on a phone. "Revoke" asks first, in place.
export function ApiKeyTable({ keys }: { keys: KeyRowView[] }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const off = !ready || pending;
  const revoke = (keyId: string) =>
    startTransition(async () => {
      const result = await revokeApiKeyAction(keyId).catch(() => failed);
      setConfirming(null);
      setMessage(revokeKeyResultText(result));
      router.refresh();
    });
  const ask = (k: KeyRowView) => (
    <div className={confirmStep}>
      <p className="text-urgent-ink">{revokeQuestion(k.label)}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className={btn.dangerSolid}
          disabled={off}
          onClick={() => revoke(k.id)}
        >
          Yes, revoke it
        </button>
        <button
          type="button"
          className={btn.secondary}
          disabled={off}
          onClick={() => setConfirming(null)}
        >
          Keep it
        </button>
      </div>
    </div>
  );
  const revokeButton = (k: KeyRowView) => (
    <button
      type="button"
      className={btn.danger}
      aria-label={`Revoke ${k.label}`}
      disabled={off || confirming !== null}
      onClick={() => {
        setMessage(null);
        setConfirming(k.id);
      }}
    >
      Revoke
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      {keys.length === 0 ? (
        <p className={`${card} text-ink-muted`}>No keys yet.</p>
      ) : (
        <>
          <div
            role="region"
            tabIndex={0}
            aria-label="API keys"
            className={`${table.wrap} hidden md:block`}
          >
            <table className={table.table}>
              <thead>
                <tr>
                  <th className={table.th}>Name</th>
                  <th className={table.th}>Key</th>
                  <th className={table.th}>Created</th>
                  <th className={table.th}>Last used</th>
                  <th className={table.th}>
                    <span className="sr-only">Revoke</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <Fragment key={k.id}>
                    <tr>
                      <td className={`${table.td} font-semibold break-words`}>{k.label}</td>
                      <td className={`${table.td} font-mono`}>{k.key}</td>
                      <td className={`${table.td} ${nums}`}>{k.created}</td>
                      <td className={`${table.td} ${nums}`}>{k.lastUsed}</td>
                      <td className={`${table.td} text-right`}>{revokeButton(k)}</td>
                    </tr>
                    {confirming === k.id && (
                      <tr>
                        <td colSpan={5} className={table.td}>
                          {ask(k)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ul role="list" className="flex flex-col gap-3 md:hidden">
            {keys.map((k) => (
              <li key={k.id} className={card}>
                <p className="font-semibold break-words">{k.label}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="font-semibold">Key</dt>
                  <dd className="font-mono">{k.key}</dd>
                  <dt className="font-semibold">Created</dt>
                  <dd className={nums}>{k.created}</dd>
                  <dt className="font-semibold">Last used</dt>
                  <dd className={nums}>{k.lastUsed}</dd>
                </dl>
                <div className="mt-3">{confirming === k.id ? ask(k) : revokeButton(k)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </div>
  );
}
