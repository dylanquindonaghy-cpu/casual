"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NewCancellation, UpdatesBell as Bell } from "@/lib/office/updates";
import {
  bellCount,
  bellLabel,
  POPUP_DISMISS,
  POPUP_OPEN,
  popupLines,
} from "@/lib/office/updates-copy";
import { btn } from "../ui/classes";
import { Icon } from "../ui/icons";

// The top bar's bell (Phase 26.4; sys-8, upd-1): Updates, with how many came in since the person
// last marked them seen (none: no number). And the pop-up (upd-3): a casual's cancellation the moment it
// lands, from the office's own refresh (every 30 seconds while the page is in view): only one that
// lands after this browser tab first opened the office (by the server's clock; earlier ones are in
// Updates and the bell, not a stack of pop-ups on logging in), each once in the tab
// (sessionStorage; a page that can't keep it shows each once until reloaded), with "Offer the
// place" while it's open again, "Open Updates" and "Dismiss".

const UPDATES_HREF = "/office/updates";

export function UpdatesBellLink({ bell }: { bell: Bell }) {
  const here = usePathname() === UPDATES_HREF;
  const count = bell.newCount;
  return (
    <Link
      href={UPDATES_HREF}
      aria-label={bellLabel(count)}
      aria-current={here ? "page" : undefined}
      className="press-glass glass-button relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
    >
      <Icon name="bell" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-canvas bg-urgent-fill px-1 text-xs font-semibold text-on-urgent tabular-nums"
        >
          {bellCount(count)}
        </span>
      )}
    </Link>
  );
}

const SHOWN_KEY = "sd-cancellations-shown";
const SINCE_KEY = "sd-cancellations-since";

// When this tab first opened the office (the server's time then), kept for the tab.
function tabSince(serverNow: Date): number {
  try {
    const kept = Number(sessionStorage.getItem(SINCE_KEY));
    if (kept > 0) return kept;
    sessionStorage.setItem(SINCE_KEY, String(serverNow.getTime()));
  } catch {
    // Not kept: from this page's first read.
  }
  return serverNow.getTime();
}
function shownBefore(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function remember(ref: string) {
  try {
    const all = [...shownBefore(), ref].slice(-50);
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify(all));
  } catch {
    // Not kept: shown once until the page reloads.
  }
}

export function CancellationPopup({ bell }: { bell: Bell }) {
  const [shown, setShown] = useState<NewCancellation | null>(null);
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [since, setSince] = useState<number | null>(null);
  // The tab's start, once it's in the browser.
  useEffect(() => {
    // Read from the tab's own storage, once: not a render to keep in step.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (since === null) setSince(tabSince(new Date(bell.now)));
  }, [bell.now, since]);
  // The newest one not shown yet in this tab, landed since it opened.
  useEffect(() => {
    if (shown || since === null) return;
    const before = shownBefore();
    const next = bell.cancellations.find(
      (c) => new Date(c.at).getTime() > since && !before.has(c.ref) && !gone.has(c.ref),
    );
    if (next) {
      remember(next.ref);
      // Shown from the office's own refresh: a new cancellation, not a render to keep in step.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShown(next);
    }
  }, [bell, shown, gone, since]);
  if (!shown) return null;
  const l = popupLines(shown, bell.timeZone);
  const close = () => {
    setGone((g) => new Set(g).add(shown.ref));
    setShown(null);
  };
  return (
    <section
      role="alert"
      aria-labelledby="cancellation-popup-title"
      data-cancellation-popup=""
      className="fixed right-3 bottom-3 left-3 z-40 flex flex-col gap-3 rounded-inner glass-float p-4 text-ink sm:left-auto sm:w-96"
    >
      <p className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-urgent-tile text-urgent-ink"
        >
          <Icon name="cancel" size={15} />
        </span>
        <span className="min-w-0">
          <b id="cancellation-popup-title" className="block font-semibold">
            {l.title}
          </b>
          <span className="block text-sm text-ink-muted">{l.line}</span>
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {l.offer && (
          <Link href={l.offer.href} onClick={close} className={btn.primary}>
            {l.offer.label}
          </Link>
        )}
        <Link href={UPDATES_HREF} onClick={close} className={btn.secondary}>
          {POPUP_OPEN}
        </Link>
        <button type="button" onClick={close} className={btn.secondary}>
          {POPUP_DISMISS}
        </button>
      </div>
    </section>
  );
}
