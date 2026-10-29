// The seats (Phase 18; src/app/ui/sign.tsx until Phase 21): a place as a square, filled when it's
// taken. On an open shift's card and its page, and the office's events board.

// More places than this and the seats would wrap into a wall: the words alone say it.
export const SEATS_MAX = 16;

// In the office (the events board), round: its corners are only 20px, 14px or round (Phase 21).
// `xl`: a shift's own page in the casual app (Phase 24: round 7's big seats, 30px).
const SEAT: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "size-3 rounded-[3px] office:rounded-full",
  md: "size-5 rounded-[5px] office:rounded-full",
  lg: "size-6 rounded-md office:rounded-full",
  xl: "size-7.5 rounded-[9px] office:rounded-full",
};

// One square per place: `taken` filled in ink, the rest free (outlined; in the urgent red when
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
      className={`flex flex-wrap ${size === "xl" ? "gap-2" : "gap-[3px] office:gap-1"} ${className}`}
    >
      {Array.from({ length: total }, (_, i) =>
        i < filled ? (
          <span key={i} data-seat="taken" className={`${SEAT[size]} bg-ink`} />
        ) : (
          <span
            key={i}
            data-seat="free"
            className={`${SEAT[size]} ${size === "xl" ? "border-2" : "border-[1.5px]"} ${free}`}
          />
        ),
      )}
    </span>
  );
}
