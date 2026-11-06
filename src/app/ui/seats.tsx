// The seats (Phase 18; src/app/ui/sign.tsx until Phase 21): a place as a mark, filled when it's
// taken. On an open shift's card and its page, and the office's events board.

// More places than this and the seats would wrap into a wall: the words alone say it.
export const SEATS_MAX = 16;

// Round, 4px apart (the office's since Phase 21, the casual app's since Phase 28: one look, and
// no corner of their own). `xl`: a shift's own page in the casual app (Phase 24: round 7's big
// seats, 30px, 8px apart).
const SEAT: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "size-3 rounded-full",
  md: "size-5 rounded-full",
  lg: "size-6 rounded-full",
  xl: "size-7.5 rounded-full",
};

// One mark per place: `taken` filled in ink, the rest free (outlined; in the urgent red when
// `urgent`). Nothing when there are more than SEATS_MAX places.
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
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  if (total <= 0 || total > SEATS_MAX) return null;
  const filled = Math.min(Math.max(0, taken), total);
  const free = urgent ? "border-urgent" : "border-ink-muted";
  return (
    <span
      aria-hidden="true"
      data-seats=""
      className={`flex flex-wrap ${size === "xl" ? "gap-2" : "gap-1"} ${className}`}
    >
      {Array.from({ length: total }, (_, i) =>
        i < filled ? (
          <span key={i} data-seat="taken" className={`${SEAT[size]} bg-ink`} />
        ) : (
          <span key={i} data-seat="free" className={`${SEAT[size]} border-[1.5px] ${free}`} />
        ),
      )}
    </span>
  );
}
