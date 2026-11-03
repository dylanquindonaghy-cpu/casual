"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

// Office pages keep themselves up to date (Phase 26, the pre-build audit's aud-2): every 30 seconds
// while the tab is in view, and as soon as you come back to it after 30 seconds or more away, the
// page asks the server for its figures again (router.refresh: the server parts redraw, what you've
// typed and opened stays, the scroll stays). Until Phase 26 an open page only changed when you did
// something on it, moved page or reloaded, so a casual's cancellation never showed by itself. The
// time of the last answer is "Updated 10:42" in the page's title row (src/app/ui/updated-stamp.tsx,
// given by office-frame.tsx). The
// demo phone does the same every few seconds (src/app/demo/auto-refresh.tsx).

export const REFRESH_SECONDS = 30;

// Whether to ask again: the tab is in view and the last answer is at least `seconds` old.
export function refreshDue(
  lastMs: number,
  nowMs: number,
  visible: boolean,
  seconds: number = REFRESH_SECONDS,
): boolean {
  return visible && nowMs - lastMs >= seconds * 1000;
}

// When the page last had its answer (ms), kept outside React's state and read through
// useSyncExternalStore, so the effects below only tell it the time (nothing is set inside them).
export function answerClock() {
  let at: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): number | null => at,
    set: (ms: number) => {
      at = ms;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The time of the page's last answer from the server: null until the page is in the browser.
// `page` is the address shown: moving to another page is a fresh answer too.
export function useAutoRefresh(page: string, seconds: number = REFRESH_SECONDS): Date | null {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [clock] = useState(answerClock);
  const at = useSyncExternalStore(clock.subscribe, clock.get, () => null);
  const last = useRef(0);
  const asked = useRef(false);

  // A page arriving (the first one, or the next you move to) is as of now.
  useEffect(() => {
    last.current = Date.now();
    clock.set(last.current);
  }, [page, clock]);

  // A refresh answered.
  useEffect(() => {
    if (refreshing || !asked.current) return;
    asked.current = false;
    last.current = Date.now();
    clock.set(last.current);
  }, [refreshing, clock]);

  useEffect(() => {
    const ask = () => {
      if (asked.current) return;
      if (!refreshDue(last.current, Date.now(), document.visibilityState === "visible", seconds))
        return;
      asked.current = true;
      start(() => router.refresh());
    };
    // Looked at every 5 seconds, so each answer is 30 seconds after the last one, give or take 5.
    const timer = setInterval(ask, Math.min(5, seconds) * 1000);
    document.addEventListener("visibilitychange", ask);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [router, seconds]);

  return at === null ? null : new Date(at);
}
