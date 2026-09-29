"use client";

import { useEffect, useState, useTransition } from "react";
import { tryAgainText } from "@/lib/portal/copy";
import { shouldShowHomeScreenHint } from "@/lib/portal/home-screen";
import { SERVICE_WORKER_URL } from "@/lib/portal/offline";
import { keyBytes, pushSettingState, type PushState } from "@/lib/portal/push-state";
import { PushSettingView } from "./push-setting-view";

// "Notifications on this phone": urgent shift alerts by web push, as well as by message. Only when
// the deployment's VAPID key is set; on an iPhone, only once the portal is on the home screen.
// On load, a phone already subscribed is saved again for this worker (quietly: unchanged is a
// no-op), so the server always matches what the phone does.
export function PushSetting({
  publicKey,
  firmName,
}: {
  publicKey: string | null;
  firmName: string;
}) {
  const [state, setState] = useState<PushState | null>(publicKey ? null : "no_key");
  const [problem, setProblem] = useState<string | null>(null);
  const [justTurnedOff, setJustTurnedOff] = useState(false);
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      setProblem(null);
      setJustTurnedOff(false);
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
      } catch {
        // Not saved: the phone mustn't stay subscribed without the server knowing.
        await subscription?.unsubscribe().catch(() => undefined);
        setProblem(tryAgainText());
      }
    });

  const turnOff = () =>
    startTransition(async () => {
      setProblem(null);
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const removed = await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          if (!removed.ok) throw new Error(`remove failed: ${removed.status}`);
          await subscription.unsubscribe();
        }
        setJustTurnedOff(true);
        setState("off");
      } catch {
        setProblem(tryAgainText());
      }
    });

  if (state === null) return null;
  return (
    <PushSettingView
      state={state}
      firmName={firmName}
      pending={pending}
      problem={problem}
      justTurnedOff={justTurnedOff}
      onTurnOn={turnOn}
      onTurnOff={turnOff}
    />
  );
}

async function save(subscription: PushSubscription): Promise<void> {
  const saved = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saved.ok) throw new Error(`save failed: ${saved.status}`);
}
