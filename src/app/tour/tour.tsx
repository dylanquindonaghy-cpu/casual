"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type Ref,
} from "react";
import { TOUR_CONTROLS } from "@/lib/tour/office-copy";
import {
  placeTip,
  readTourPlace,
  SPOT_PAD,
  TOUR_STORE,
  type Placed,
  type Rect,
  type TourStep,
} from "@/lib/tour/steps";
import type { TourOutcome } from "@/lib/tour/seen";
import { btn } from "../ui/classes";

// The first-login tours' engine (Phase 33; docs/screens.md "## Phase 33"), shared by the office's
// (33.2) and the casuals' (33.3): a welcome window (each tour draws its own, ./welcome.tsx), then
// a walkthrough on the real pages. Each step highlights the element carrying its `data-tour`
// anchor (the first one showing, so a part drawn twice for a phone and a laptop is found at either
// width) with a cut-out in a dimmed screen and a lime outline, and a raised-glass tip beside it
// ("Step n of N", dots, Back, Next or Done, Skip). A step whose element isn't on the page is passed
// over. A step on another page goes there and carries on: the tour's place is kept in the tab's
// session storage (TOUR_STORE), so it survives the move (and a reload). One native modal dialog
// holds the screen, the outline and the tip, so the page behind can't be reached and focus stays in
// the tip; Esc skips, ← and → go back and on; focus goes back where it was when it ends. With less
// motion asked for, nothing slides or scrolls smoothly. It re-places on resize and scroll.

export interface TourApi {
  open(): void; // the welcome window, whether or not the person has seen the tour
}

type Phase = { at: "closed" } | { at: "welcome" } | { at: "walk"; step: number };

// How long a step waits for its element (a page still arriving) before it's passed over.
const ANCHOR_WAIT_MS = 2000;

function shownAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && !el.closest("[hidden]")) return el;
  }
  return null;
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function store(place: { id: string; step: number } | null) {
  try {
    if (place) sessionStorage.setItem(TOUR_STORE, JSON.stringify(place));
    else sessionStorage.removeItem(TOUR_STORE);
  } catch {
    // storage off: a move between pages starts the walkthrough's page afresh
  }
}

export function TourHost({
  id,
  steps,
  autoOpen,
  laterKey,
  onEnd,
  Welcome,
  apiRef,
}: {
  id: string; // "office" or "casual"
  steps: readonly TourStep[];
  autoOpen: boolean; // not seen yet, and on the page where it starts by itself
  laterKey: string; // this login's own: "Not now" holds for it, and the next login asks again
  onEnd: (outcome: TourOutcome) => Promise<unknown>;
  // The tour's own welcome window (./welcome.tsx with its video and words).
  Welcome: ComponentType<{ onStart: () => void; onNotNow: () => void }>;
  apiRef?: Ref<TourApi>;
}) {
  const [phase, setPhase] = useState<Phase>({ at: "closed" });
  const asked = useRef(false); // opened by itself once in this page's life
  const before = useRef<HTMLElement | null>(null);

  const remember = () => {
    if (!before.current && document.activeElement instanceof HTMLElement)
      before.current = document.activeElement;
  };
  const giveBackFocus = () => {
    const el = before.current;
    before.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  };

  useImperativeHandle(apiRef, () => ({
    open() {
      asked.current = true;
      remember();
      store(null);
      setPhase({ at: "welcome" });
    },
  }));

  // A walkthrough under way (it moved page, or the page reloaded): carry on.
  useEffect(() => {
    let place = null;
    try {
      place = readTourPlace(sessionStorage.getItem(TOUR_STORE));
    } catch {
      place = null;
    }
    if (!place || place.id !== id || place.step >= steps.length) return;
    asked.current = true;
    const step = place.step;
    const frame = requestAnimationFrame(() => setPhase({ at: "walk", step }));
    return () => cancelAnimationFrame(frame);
  }, [id, steps.length]);

  // By itself, once: not seen yet, and not put off with "Not now" in this login.
  useEffect(() => {
    if (!autoOpen || asked.current) return;
    let later = false;
    try {
      later = localStorage.getItem(`sd-tour-later:${id}`) === laterKey;
    } catch {
      later = false;
    }
    asked.current = true;
    if (later) return;
    const frame = requestAnimationFrame(() => {
      remember();
      setPhase({ at: "welcome" });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoOpen, id, laterKey]);

  const end = useCallback(
    (outcome: TourOutcome) => {
      store(null);
      setPhase({ at: "closed" });
      giveBackFocus();
      void onEnd(outcome).catch(() => undefined);
    },
    [onEnd],
  );

  const notNow = () => {
    try {
      localStorage.setItem(`sd-tour-later:${id}`, laterKey);
    } catch {
      // storage off: it asks again on the next page load
    }
    setPhase({ at: "closed" });
    giveBackFocus();
  };

  const go = useCallback(
    (step: number) => {
      store({ id, step });
      setPhase({ at: "walk", step });
    },
    [id],
  );

  if (phase.at === "welcome") return <Welcome onStart={() => go(0)} onNotNow={notNow} />;
  if (phase.at === "walk")
    return (
      <Walkthrough
        steps={steps}
        step={phase.step}
        go={go}
        onSkip={() => end("skipped")}
        onDone={() => end("finished")}
      />
    );
  return null;
}

function Walkthrough({
  steps,
  step,
  go,
  onSkip,
  onDone,
}: {
  steps: readonly TourStep[];
  step: number;
  go: (step: number) => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const dir = useRef<1 | -1>(1);
  // The highlighted part's place, for the step it was measured at (a new step shows nothing until its
  // part is found and measured).
  const [measured, setMeasured] = useState<{ step: number; rect: Rect } | null>(null);
  const stepNow = useRef(step);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const done = useRef(onDone);
  const goTo = useRef(go);
  useEffect(() => {
    done.current = onDone;
    goTo.current = go;
    stepNow.current = step;
  });
  const s = steps[step];
  const last = step === steps.length - 1;
  const elsewhere = s?.path !== undefined && s.path !== pathname;

  // The screen and tip in the top layer, the page behind out of reach.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const measure = useCallback(() => {
    const el = target.current;
    if (!el?.isConnected) return;
    const r = el.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    setMeasured({ step: stepNow.current, rect });
    const h = tip.current?.offsetHeight ?? 200;
    setPlaced(
      placeTip(
        {
          left: rect.left - SPOT_PAD,
          top: rect.top - SPOT_PAD,
          width: rect.width + SPOT_PAD * 2,
          height: rect.height + SPOT_PAD * 2,
        },
        { height: h },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
      ),
    );
  }, []);

  // To the step's page; there, wait for its element, or pass the step over.
  useEffect(() => {
    if (!s) return;
    target.current = null;
    stepNow.current = step;
    if (elsewhere) {
      router.push(s.path ?? "/");
      return;
    }
    const started = Date.now();
    let frame = 0;
    const look = () => {
      const el = shownAnchor(s.anchor);
      if (el) {
        target.current = el;
        el.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: reduced() ? "auto" : "smooth",
        });
        // Measured once the scroll has settled, and on every scroll after.
        frame = requestAnimationFrame(measure);
        return;
      }
      if (Date.now() - started < ANCHOR_WAIT_MS) {
        frame = requestAnimationFrame(look);
        return;
      }
      // Not on this page: the next one along (or the one before, going back).
      const n = step + dir.current;
      if (n >= 0 && n < steps.length) goTo.current(n);
      else if (dir.current === 1) done.current();
      else {
        dir.current = 1;
        if (step + 1 < steps.length) goTo.current(step + 1);
        else done.current();
      }
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [s, step, steps.length, elsewhere, router, measure]);

  // Re-placed on resize and on any scroll (the page's or a box's).
  useEffect(() => {
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, { capture: true });
    };
  }, [measure]);

  // The tip's height known: placed again with it; focus into the tip at each step.
  const spot = measured && measured.step === step ? measured.rect : null;
  const ready = spot !== null;
  useLayoutEffect(() => {
    if (ready) measure();
  }, [step, ready, measure]);
  useEffect(() => {
    if (ready) tip.current?.focus({ preventScroll: true });
  }, [step, ready]);

  const back = () => {
    if (step === 0) return;
    dir.current = -1;
    go(step - 1);
  };
  const next = () => {
    dir.current = 1;
    if (last) onDone();
    else go(step + 1);
  };

  const onKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    } else if (e.key === "Tab") {
      // Round and round inside the tip.
      const buttons = [...(tip.current?.querySelectorAll<HTMLElement>("button") ?? [])];
      const first = buttons[0];
      const end = buttons[buttons.length - 1];
      if (!first || !end) return;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === tip.current)) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && at === end) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  if (!s) return null;
  const hole = spot
    ? {
        x: spot.left - SPOT_PAD,
        y: spot.top - SPOT_PAD,
        w: spot.width + SPOT_PAD * 2,
        h: spot.height + SPOT_PAD * 2,
      }
    : null;
  const titleId = `tour-step-title`;
  return (
    <dialog
      ref={dialog}
      data-tour-walk=""
      data-step={step}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: the walkthrough is skipped (and won't open by itself again).
        e.preventDefault();
        onSkip();
      }}
      onKeyDown={onKey}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-base text-ink backdrop:bg-transparent"
    >
      {/* The screen, dimmed, with the element cut out. */}
      <svg aria-hidden="true" className="absolute inset-0 size-full" focusable="false">
        <path
          fillRule="evenodd"
          className="fill-scrim/60"
          d={`M0 0H${10000}V${10000}H0Z${hole ? `M${hole.x + 12} ${hole.y}H${hole.x + hole.w - 12}A12 12 0 0 1 ${hole.x + hole.w} ${hole.y + 12}V${hole.y + hole.h - 12}A12 12 0 0 1 ${hole.x + hole.w - 12} ${hole.y + hole.h}H${hole.x + 12}A12 12 0 0 1 ${hole.x} ${hole.y + hole.h - 12}V${hole.y + 12}A12 12 0 0 1 ${hole.x + 12} ${hole.y}Z` : ""}`}
        />
      </svg>
      {hole && (
        <div
          aria-hidden="true"
          data-tour-spot={s.anchor}
          className="pointer-events-none absolute rounded-card outline-2 outline-offset-2 outline-accent transition-[left,top,width,height] duration-200 ease-sd motion-reduce:transition-none"
          style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
        />
      )}
      <div
        ref={tip}
        tabIndex={-1}
        data-tour-tip=""
        aria-live="polite"
        className="glass-float absolute flex flex-col gap-3 rounded-card p-4 transition-[left,top] duration-200 ease-sd focus:outline-none motion-reduce:transition-none"
        style={
          placed && spot
            ? { left: placed.left, top: placed.top, width: placed.width }
            : { left: 16, top: 16, width: 340, visibility: "hidden" }
        }
      >
        <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
          <span>{TOUR_CONTROLS.stepOf(step + 1, steps.length)}</span>
          <span aria-hidden="true" className="flex items-center gap-1">
            {steps.map((x, i) => (
              <i
                key={`${x.anchor}-${i}`}
                className={`block h-2 rounded-full ${i === step ? "w-4 bg-accent" : "w-2 bg-ink/20"}`}
              />
            ))}
          </span>
        </div>
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {s.title}
        </h2>
        <p className="text-base text-ink-muted">{s.body}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onSkip} className={btn.text}>
            {TOUR_CONTROLS.skip}
          </button>
          <span aria-hidden="true" className="flex-1" />
          {step > 0 && (
            <button type="button" onClick={back} className={btn.secondary}>
              {TOUR_CONTROLS.back}
            </button>
          )}
          <button type="button" onClick={next} className={btn.primary}>
            {last ? TOUR_CONTROLS.done : TOUR_CONTROLS.next}
          </button>
        </div>
      </div>
    </dialog>
  );
}
