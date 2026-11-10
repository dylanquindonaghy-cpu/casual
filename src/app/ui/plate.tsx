import type { ReactNode } from "react";

// A solid status plate (Phase 18; docs/ui-design.md "Sign parts"), for the few places a status
// must catch the eye: a day's "1 urgent" on the week strip, a count that needs someone, "New".
// Its words always say the status (the colour never does alone). Urgent is red, needs doing amber,
// done green, waiting a sunk grey, `brand` the firm's colour (soft tints since Phase 32). Elsewhere statuses are the
// pale <StatusChip>. Round, as the office's counts (Phase 28; a 4px corner until then). Hook-free.

export type PlateTone = "urgent" | "hivis" | "done" | "waiting" | "brand";

// Phase 32 (32.3; the office's badges): each a soft tint with its own words and the glass's
// hairline, never a solid fill (urgent the office's soft red, needs doing its amber, done its green).
const TONE: Record<PlateTone, string> = {
  urgent: "glass-rim bg-urgent-soft text-urgent-ink",
  hivis: "glass-rim bg-attention-soft text-attention-ink",
  done: "glass-rim bg-done-soft text-done-ink",
  waiting: "bg-raised text-ink-muted",
  brand: "glass-rim bg-brand-soft text-brand-ink",
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
      className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
