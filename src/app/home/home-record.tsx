import { RECORD_CARD_TITLE } from "@/lib/portal/home-copy";
import type { RecordFigure } from "@/lib/portal/home-board";
import { RECORD_PATH, RECORD_TITLE } from "@/lib/portal/record-copy";
import { HomeCard } from "./home-card";

// "Your record" on Home (Phase 30.1; docs/screens.md "### 30.1"): shifts worked and reliability
// over the last 90 days and the strikes that still count, the figures Profile shows (and the
// office sees), each large with its words under it; "Your shift record" for the detail. Shown in
// the kept copy too. Hook-free.
export function HomeRecord({
  figures,
  className,
}: {
  figures: RecordFigure[];
  className?: string;
}) {
  return (
    <HomeCard
      id="record"
      title={RECORD_CARD_TITLE}
      link={{ href: RECORD_PATH, label: RECORD_TITLE }}
      className={className}
    >
      <dl className={`grid gap-2 px-1 ${figures.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {figures.map((f) => (
          <div key={f.key} data-figure={f.key} className="flex flex-col-reverse gap-0.5">
            <dt className="text-sm text-ink-muted">{f.label}</dt>
            <dd className="font-sign text-2xl leading-tight text-ink tabular-nums">{f.figure}</dd>
          </div>
        ))}
      </dl>
    </HomeCard>
  );
}
