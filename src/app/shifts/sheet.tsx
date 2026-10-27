"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

// A sheet that rises from the bottom of the phone (Phase 18: "Can't make it?"), a native modal
// <dialog>: the page behind it is dimmed and can't be reached, Escape and a tap on the dim close
// it, and focus returns to what opened it. It rises over 250ms and the dim fades in over 150ms
// (a 150ms fade with reduced motion: globals.css). `open` shows it; `onClose` hears every way it
// closes, so the opener can forget it. `locked`: while something it started is being sent, Escape
// and a tap on the dim leave it open (a browser may still close it on a second Escape: `onClose`
// hears that too).
//
// Its handle is a real one (Phase 20): pull it down and the sheet follows the finger; let go
// more than PULL_CLOSE px down and it closes, less and it goes back. Not while `locked`. For
// touch and the mouse alike; the keyboard has Escape and the sheet's own buttons. The handle
// stays at the top while the sheet scrolls (a long sheet on a small phone), so it can always be
// pulled.
export const PULL_CLOSE = 96;

export function Sheet({
  open,
  onClose,
  labelledBy,
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  locked?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pull = useRef<{ id: number; from: number; by: number } | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const follow = (by: number) => {
    const d = dialog.current;
    if (!d) return;
    // `translate`, not `transform`: the rise is an animation of `transform`, which would win.
    d.style.translate = by > 0 ? `0 ${by}px` : "";
    d.style.transition = by > 0 ? "none" : "";
  };
  const grab = (e: PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pull.current = { id: e.pointerId, from: e.clientY, by: 0 };
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    p.by = Math.max(0, e.clientY - p.from);
    follow(p.by);
  };
  const letGo = (e: PointerEvent<HTMLDivElement>) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    pull.current = null;
    follow(0);
    if (p.by > PULL_CLOSE && !locked) dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => {
        if (locked) e.preventDefault();
      }}
      // A tap on the dim lands on the dialog itself (its content fills it).
      onClick={(e) => {
        if (!locked && e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-md animate-sheet overflow-y-auto rounded-t-[28px] glass-float p-0 text-lg text-ink transition-transform duration-200 ease-sd backdrop:animate-fade backdrop:bg-scrim/50"
    >
      {open ? (
        <div className="flex flex-col gap-4 px-5 pb-7">
          <div
            aria-hidden="true"
            data-sheet-handle=""
            onPointerDown={grab}
            onPointerMove={drag}
            onPointerUp={letGo}
            onPointerCancel={letGo}
            className="sticky top-0 z-10 -mx-5 flex cursor-grab touch-none justify-center bg-panel pt-2.5 pb-1.5 active:cursor-grabbing"
          >
            <span className="h-1.25 w-10 rounded-full bg-line-strong" />
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
