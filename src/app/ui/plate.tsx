import type { ReactNode } from "react";

// A solid status plate (Phase 18; docs/ui-design.md "Sign parts"), for the few places a status
// must catch the eye: a day's "1 urgent" on the week strip, a count that needs someone, "New".
// Its words always say the status (the colour never does alone). Urgent is red, needs doing sign
// yellow, done green, waiting a sunk grey, `brand` the firm's colour. Elsewhere statuses are the
// pale <StatusChip>. Hook-free.

export type PlateTone = "urgent" | "hivis" | "done" | "waiting" | "brand";

const TONE: Record<PlateTone, string> = {
  urgent: "bg-urgent-fill text-on-urgent",
  hivis: "bg-hivis text-on-hivis",
  done: "bg-done-fill text-on-done",
  waiting: "bg-raised text-ink-muted",
  brand: "bg-brand text-on-brand",
};

export function Plate({
  tone,
  children,
  className = "",
}: {
  tone: PlateTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1.5 text-sm font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
