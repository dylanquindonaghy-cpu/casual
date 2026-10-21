"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A sheet that rises from the bottom of the phone (Phase 18: "Can't make it?"), a native modal
// <dialog>: the page behind it is dimmed and can't be reached, Escape and a tap on the dim close
// it, and focus returns to what opened it. It rises over 250ms and the dim fades in over 150ms
// (a 150ms fade with reduced motion: globals.css). `open` shows it; `onClose` hears every way it
// closes, so the opener can forget it. `locked`: while something it started is being sent, Escape
// and a tap on the dim leave it open (a browser may still close it on a second Escape: `onClose`
// hears that too).
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

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

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
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-md animate-sheet overflow-y-auto rounded-t-2xl bg-card p-0 text-lg text-ink backdrop:animate-fade backdrop:bg-scrim/50"
    >
      {open ? (
        <div className="flex flex-col gap-4 px-5 pt-2.5 pb-7">
          <span
            aria-hidden="true"
            className="h-1.25 w-11 self-center rounded-full bg-line-strong"
          />
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
