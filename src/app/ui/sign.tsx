import type { ReactNode } from "react";

// The design's venue parts (Phases 18 and 20; docs/ui-design.md "Sign parts"), shared by the
// casual app and the office: the date tile (a small raised card: the weekday, the day in sign
// figures, the month; pale red when urgent), the plate (a gate or post, in the firm's pale tint)
// and the seats (one square per place: filled when taken, outlined when free). Decorative: each
// takes or sits beside words that say the same, so a screen reader hears it once. Hook-free.

type TileSize = "lg" | "md" | "sm";

const TILE: Record<TileSize, { box: string; dow: string; day: string }> = {
  lg: { box: "w-16 rounded-2xl pt-2 pb-2.5", dow: "text-sm", day: "text-3xl" },
  md: { box: "w-13 rounded-[14px] pt-1.5 pb-2", dow: "text-sm", day: "text-2xl" },
  sm: { box: "w-12 rounded-xl py-1.5", dow: "text-xs", day: "text-lg" },
};

// `urgent`: pale red with the urgent words (an urgent shift's tile).
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
        urgent ? "bg-urgent-tile text-urgent-ink" : "bg-raised text-ink"
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

// "Gate 2": a plate in the firm's pale tint. `size` md on a shift's page, sm in a list.
export function SignPlate({ children, size = "md" }: { children: ReactNode; size?: "md" | "sm" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[10px] bg-brand-soft font-semibold text-brand-ink ${
        size === "md" ? "min-h-8 px-2.5 text-base" : "min-h-6 px-2 text-sm"
      }`}
    >
      {children}
    </span>
  );
}
