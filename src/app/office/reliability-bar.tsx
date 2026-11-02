import { reliabilityWords, type Reliability } from "@/lib/rules/reliability";

// A casual's reliability (Phase 26.7, cas-1; decision 3): the figure ("98%", or "New: 3 shifts so
// far" under 5 counted shifts: aud-11) and, for a figure, a bar in its band's colour (green from
// 90%, amber from 75%, red below). Worked out by code (src/lib/rules/reliability.ts).
const BAND_BAR = { green: "bg-done-fill", amber: "bg-attention", red: "bg-urgent-fill" };

export function ReliabilityBar({ reliability }: { reliability: Reliability }) {
  return (
    <span className="flex flex-col gap-1" data-reliability="">
      <span className="font-semibold text-ink tabular-nums">{reliabilityWords(reliability)}</span>
      {reliability.kind === "figure" && (
        <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
          <span
            className={`block h-full rounded-full ${BAND_BAR[reliability.band]}`}
            style={{ width: `${reliability.percent}%` }}
          />
        </span>
      )}
    </span>
  );
}
