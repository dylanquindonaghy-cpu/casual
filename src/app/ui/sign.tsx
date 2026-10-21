import type { ReactNode } from "react";

// The design's venue parts (Phase 18; docs/ui-design.md "Sign parts"), shared by the casual app
// and the office: the date tile (a calendar page: its weekday on a band, the day in sign figures,
// the month), the sign plate (a gate or post, light on dark like a venue's own signs) and the
// seats (one square per place: filled when taken, dashed when free). Decorative: each takes or
// sits beside words that say the same, so a screen reader hears it once. Hook-free.

type TileSize = "lg" | "md" | "sm";

const TILE: Record<TileSize, { box: string; band: string; day: string }> = {
  lg: { box: "w-18 rounded-lg", band: "text-base", day: "pt-1.5 text-4xl" },
  md: { box: "w-14 rounded-md", band: "text-sm", day: "text-3xl" },
  sm: { box: "w-13 rounded-md", band: "text-sm", day: "text-2xl" },
};

// `urgent`: the band and the edge in the urgent red (an urgent shift's tile).
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
  const edge = urgent ? "border-urgent-fill" : "border-ink";
  const band = urgent ? "bg-urgent-fill text-on-urgent" : "bg-ink text-on-ink";
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={`flex shrink-0 flex-col overflow-hidden border-[1.5px] bg-card text-center ${t.box} ${edge}`}
    >
      <span className={`block py-px font-semibold ${t.band} ${band}`}>{dow}</span>
      <span className={`block font-sign leading-none text-ink ${t.day} ${month ? "" : "py-1.5"}`}>
        {day}
      </span>
      {month && <span className="block pt-0.5 pb-1.5 text-base text-ink-muted">{month}</span>}
    </span>
  );
}

// "Gate 2": a sign plate. `size` md on the pass, sm in a list.
export function SignPlate({ children, size = "md" }: { children: ReactNode; size?: "md" | "sm" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded bg-ink font-sign text-on-ink ${
        size === "md" ? "h-9 px-3 text-2xl" : "h-7 px-2 text-lg"
      }`}
    >
      {children}
    </span>
  );
}

// More places than this and the seats would wrap into a wall: the words alone say it.
export const SEATS_MAX = 16;

const SEAT: Record<"sm" | "md" | "lg", string> = {
  sm: "size-3 rounded-[2px]",
  md: "size-6 rounded",
  lg: "size-[26px] rounded",
};

// One square per place: `taken` filled, the rest free (dashed; red when `urgent`). Nothing when
// there are more than SEATS_MAX places.
export function Seats({
  taken,
  total,
  urgent = false,
  size = "sm",
  className = "",
}: {
  taken: number;
  total: number;
  urgent?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (total <= 0 || total > SEATS_MAX) return null;
  const filled = Math.min(Math.max(0, taken), total);
  const free = urgent ? "border-urgent-fill" : "border-ink";
  return (
    <span aria-hidden="true" data-seats="" className={`flex flex-wrap gap-1 ${className}`}>
      {Array.from({ length: total }, (_, i) =>
        i < filled ? (
          <span key={i} data-seat="taken" className={`${SEAT[size]} bg-ink-muted`} />
        ) : (
          <span
            key={i}
            data-seat="free"
            className={`${SEAT[size]} border-2 ${size === "sm" ? "" : "border-dashed"} ${free}`}
          />
        ),
      )}
    </span>
  );
}
