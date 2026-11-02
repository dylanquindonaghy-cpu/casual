"use client";

import { useEffect, useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { tryAgainText } from "@/lib/portal/copy";
import { shouldShowHomeScreenHint } from "@/lib/portal/home-screen";
import { SERVICE_WORKER_URL } from "@/lib/portal/offline";
import { keyBytes, pushSettingState, type PushState } from "@/lib/portal/push-state";
import {
  DEVICE_OFF,
  DEVICE_ON,
  DEVICE_TITLE,
  DEVICE_TURNED_OFF,
  DEVICE_TURNED_ON,
  DEVICE_WORDS,
  TELL_ME_KINDS,
  TELL_ME_ROWS,
  TELL_ME_TITLE,
  tellMeLine,
  tellMeResultText,
  type TellMeKind,
} from "@/lib/office/tell-me-copy";
import { btn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { saveTellMeAction } from "./tell-me-actions";

const failed = { status: "error" as const };
const OFFICE_PUSH = "/api/office/push";

// Updates' "Tell me about" (Phase 26.4; the spec's upd-4 and upd-5, decision 5; the mock-up's panel
// beside the list): each switch saves at once to the person (and is logged), its answer under the
// list. Then this device's own notifications: the two notification switches reach only browsers
// that turned them on here (as a casual's "Notifications on this phone": src/app/profile/
// push-setting.tsx, on the office's own route). Waits for the page (docs/ui-design.md "Forms wait
// for the page").
export function TellMePanel({
  tellMe,
  mine,
  publicKey,
}: {
  tellMe: TellMeKind[];
  mine: boolean;
  publicKey: string | null;
}) {
  const ready = useHydrated();
  const [on, setOn] = useState<Set<TellMeKind>>(() => new Set(tellMe));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const flip = (kind: TellMeKind, next: boolean) =>
    start(async () => {
      setOn((s) => {
        const copy = new Set(s);
        if (next) copy.add(kind);
        else copy.delete(kind);
        return copy;
      });
      const r = await saveTellMeAction(kind, next).catch(() => failed);
      setMessage(tellMeResultText(r));
      // Not saved: the switch goes back to what's saved.
      if (r.status !== "saved") {
        setOn((s) => {
          const copy = new Set(s);
          if (next) copy.delete(kind);
          else copy.add(kind);
          return copy;
        });
      }
    });
  return (
    <section
      id="tell-me-about"
      aria-labelledby="tell-me-title"
      className="glass flex flex-col gap-4 rounded-inner p-4"
    >
      <div className="px-1">
        <h2 id="tell-me-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Icon name="settings" size={16} className="text-ink-muted" />
          {TELL_ME_TITLE}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{tellMeLine(mine)}</p>
      </div>
      <ul role="list" className="flex flex-col gap-2">
        {TELL_ME_KINDS.map((k) => (
          <li key={k}>
            <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-row glass-tile px-4 py-3 has-disabled:cursor-not-allowed">
              <span className="min-w-0">
                <b className="block font-medium text-ink">{TELL_ME_ROWS[k].title}</b>
                <span className="block text-sm text-ink-faint">{TELL_ME_ROWS[k].line}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={on.has(k)}
                disabled={!ready || pending}
                onChange={(e) => flip(k, e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-switch-off p-1 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-60 [&>span]:transition-transform peer-checked:[&>span]:translate-x-4"
              >
                <span className="size-4 rounded-full bg-knob duration-150 ease-sd motion-reduce:transition-none" />
              </span>
            </label>
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="px-1 text-sm text-ink-muted">
          {message}
        </p>
      )}
      <ThisDevice publicKey={publicKey} />
    </section>
  );
}

// This browser's notifications: on (subscribed and saved for the person), off, or why not.
function ThisDevice({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<PushState | null>(publicKey ? null : "no_key");
  const [said, setSaid] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!publicKey) return;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    const iPhone = shouldShowHomeScreenHint({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone,
      dismissed: false,
    });
    const decide = (subscribed: boolean) =>
      setState(
        pushSettingState({
          hasKey: true,
          supported,
          iPhoneNotOnHomeScreen: iPhone,
          permission: supported ? Notification.permission : "default",
          subscribed,
        }),
      );
    if (!supported) return decide(false);
    // Already subscribed: saved again for this person (unchanged is a no-op), so the server
    // matches what the browser does.
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription() ?? null)
      .then(async (sub) => {
        if (sub) await save(sub).catch(() => undefined);
        decide(!!sub);
      })
      .catch(() => decide(false));
  }, [publicKey]);

  const turnOn = () =>
    start(async () => {
      setSaid(null);
      let subscription: PushSubscription | null = null;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
        await navigator.serviceWorker.ready;
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey ?? "") as BufferSource,
        });
        await save(subscription);
        setState("on");
        setSaid(DEVICE_TURNED_ON);
      } catch {
        // Not saved: the browser mustn't stay subscribed without the server knowing.
        await subscription?.unsubscribe().catch(() => undefined);
        setSaid(tryAgainText());
      }
    });

  const turnOff = () =>
    start(async () => {
      setSaid(null);
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const removed = await fetch(OFFICE_PUSH, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!removed.ok) throw new Error(`remove failed: ${removed.status}`);
          await subscription.unsubscribe();
        }
        setState("off");
        setSaid(DEVICE_TURNED_OFF);
      } catch {
        setSaid(tryAgainText());
      }
    });

  if (state === null) return null;
  return (
    <div data-device-push={state} className="flex flex-col gap-2 border-t border-line px-1 pt-4">
      <h3 className="font-semibold text-ink">{DEVICE_TITLE}</h3>
      <p className="text-sm text-ink-muted">{DEVICE_WORDS[state]}</p>
      {state === "off" && (
        <button
          type="button"
          onClick={turnOn}
          disabled={pending}
          className={`${btn.secondary} self-start`}
        >
          {DEVICE_ON}
        </button>
      )}
      {state === "on" && (
        <button
          type="button"
          onClick={turnOff}
          disabled={pending}
          className={`${btn.secondary} self-start`}
        >
          {DEVICE_OFF}
        </button>
      )}
      {said && (
        <p role="status" className="text-sm text-ink-muted">
          {said}
        </p>
      )}
    </div>
  );
}

async function save(subscription: PushSubscription): Promise<void> {
  const saved = await fetch(OFFICE_PUSH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saved.ok) throw new Error(`save failed: ${saved.status}`);
}
