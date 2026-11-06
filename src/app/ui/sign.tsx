import type { ReactNode } from "react";

// The design's venue parts (Phases 18 and 20; docs/ui-design.md "Sign parts"), shared by the
// casual app and the office: the date tile (a small glass tile: the weekday, the day in sign
// figures, the month; pale red when urgent), the plate (a gate or post, in the firm's pale tint)
// and the seats (one mark per place: filled when taken, outlined when free). Decorative: each
// takes or sits beside words that say the same, so a screen reader hears it once. Hook-free.
// Phase 28 (28.1): 8px round from the tokens, as the office's date tile on its dashboard.

type TileSize = "lg" | "md" | "sm";

const TILE: Record<TileSize, { box: string; dow: string; day: string }> = {
  lg: { box: "w-16 rounded-row pt-2 pb-2.5", dow: "text-sm", day: "text-3xl" },
  md: { box: "w-13 rounded-row pt-1.5 pb-2", dow: "text-sm", day: "text-2xl" },
  sm: { box: "w-12 rounded-row py-1.5", dow: "text-xs", day: "text-lg" },
};

// `urgent`: pale red with the urgent words and the glass's hairline (an urgent shift's tile);
// otherwise clear glass with ink words (the office's: `glass-button`).
export function DateTile({
  dow,
  day,
  month,
  size = "md",
  urgent = false,
  label,
}: {
  dow: string;
  day: string;
  month?: string;
  size?: TileSize;
  urgent?: boolean;
  label?: string; // "Saturday 24 October": the tile is then an image with that name
}) {
  const t = TILE[size];
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={`flex shrink-0 flex-col items-center self-start text-center ${t.box} ${
        urgent ? "glass-rim bg-urgent-tile text-urgent-ink" : "glass-button text-ink"
      }`}
    >
      <span className={`block font-medium ${t.dow}`}>{dow}</span>
      <span className={`block font-sign leading-tight ${t.day}`}>{day}</span>
      {month && (
        <span className={`block text-xs ${urgent ? "text-urgent-ink" : "text-ink-muted"}`}>
          {month}
        </span>
      )}
    </span>
  );
}

// "Gate 2": a plate in the firm's pale tint, 8px round. `size` md on a shift's page, sm in a list.
export function SignPlate({ children, size = "md" }: { children: ReactNode; size?: "md" | "sm" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-row bg-brand-soft font-semibold text-brand-ink ${
        size === "md" ? "min-h-8 px-2.5 text-base" : "min-h-6 px-2 text-sm"
      }`}
    >
      {children}
    </span>
  );
}
