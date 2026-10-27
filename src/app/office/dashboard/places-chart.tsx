import Link from "next/link";
import {
  CHART_KEY,
  CHART_SUB,
  CHART_TITLE,
  chartSummary,
  chartTop,
  dayTip,
} from "@/lib/office/board-copy";
import type { ChartDay } from "@/lib/office/dashboard-board";
import { datePartsOfDay } from "@/lib/portal/sign-copy";
import { Icon } from "../../ui/icons";
import { HoverTips } from "./hover-tips";

// Places to fill (Phase 24, 24.3; round 7 of the canvas): this pay week and next, a bar a day,
// stacked from the foot: the places with no offer out (ink) and, on them, those offered with no
// reply yet (blue). The axis reads 0, half and the top (chartTop); today's date sits in an ink
// disc; "This week" and "Next week" under the days. A bar's numbers show under the pointer
// (./hover-tips.tsx: they can be hovered, and Escape puts them away); the same numbers are a table
// for a screen reader, and the chart says what it shows in a sentence.
// The round ↗ opens Events & sessions' "Need people", where every place to fill is.

export const CHART_ID = "places-chart";

export function PlacesChart({ days, today }: { days: ChartDay[]; today: string }) {
  const top = chartTop(days);
  const height = (n: number) => `${(n / top) * 100}%`;
  return (
    <section
      id={CHART_ID}
      aria-labelledby={`${CHART_ID}-title`}
      aria-describedby={`${CHART_ID}-summary`}
      className="glass flex min-w-0 flex-col rounded-inner p-4 @min-[36rem]:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 id={`${CHART_ID}-title`} className="text-lg font-semibold tracking-heading text-ink">
            {CHART_TITLE}
          </h2>
          <p className="text-sm text-ink-muted">{CHART_SUB}</p>
        </div>
        <Link
          href="/office/events?view=need"
          aria-label="Open Events & sessions"
          className="press-glass glass-button ml-auto flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
        >
          <Icon name="out" size={18} />
        </Link>
      </div>
      <p id={`${CHART_ID}-summary`} className="sr-only">
        {chartSummary(days)}
      </p>
      <div
        aria-hidden="true"
        className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted"
      >
        <span className="inline-flex items-center gap-2">
          <i className="size-3 rounded-mark bg-mark-open" />
          {CHART_KEY.toOffer}
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-3 rounded-mark bg-mark-wait" />
          {CHART_KEY.offered}
        </span>
      </div>
      <HoverTips className="mt-4 grid min-h-44 flex-1 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
        <div className="relative text-right text-xs leading-none text-ink-muted tabular-nums">
          <span className="absolute top-0 right-0 -translate-y-1/2">{top}</span>
          <span className="absolute top-1/2 right-0 -translate-y-1/2">{top / 2}</span>
          <span className="absolute top-full right-0 -translate-y-1/2">0</span>
        </div>
        <div className="relative grid grid-cols-14 items-end border-b border-mark-base before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-mark-grid after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-mark-grid">
          {days.map((d) => {
            const tip = dayTip(d);
            return (
              <div
                key={d.date}
                data-day={d.date}
                className="group/bar relative z-10 flex h-full flex-col items-center justify-end"
              >
                {d.offered > 0 && (
                  <span
                    data-part="offered"
                    style={{ height: height(d.offered) }}
                    className="w-[55%] max-w-5.5 rounded-t-mark bg-mark-wait transition-[height] duration-200 ease-sd"
                  />
                )}
                {d.toOffer > 0 && (
                  <span
                    data-part="to-offer"
                    style={{ height: height(d.toOffer) }}
                    className={`w-[55%] max-w-5.5 bg-mark-open transition-[height] duration-200 ease-sd${d.offered > 0 ? "" : " rounded-t-mark"}`}
                  />
                )}
                <span
                  data-bar-tip=""
                  className="absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-row bg-ink px-3 py-1 text-sm whitespace-nowrap text-on-ink before:absolute before:inset-x-0 before:top-full before:h-2 pointer-fine:group-hover/bar:block in-data-[away]:hidden!"
                >
                  {tip}
                </span>
              </div>
            );
          })}
        </div>
      </HoverTips>
      <div
        aria-hidden="true"
        className="mt-2 ml-8 grid grid-cols-14 text-center text-xs text-ink-muted tabular-nums"
      >
        {days.map((d) => (
          <span key={d.date} className="flex justify-center">
            <span
              className={
                d.date === today
                  ? "min-w-6 rounded-full bg-ink px-1 font-semibold text-on-ink"
                  : undefined
              }
            >
              {datePartsOfDay(d.date).day}
            </span>
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 ml-8 grid grid-cols-2 text-xs text-ink-muted">
        <span>This week</span>
        <span className="border-l border-line pl-2">Next week</span>
      </div>
      {/* A table sizes to its cells whatever its width says, so the box around it is what hides
          it (sr-only), and clips it. */}
      <div className="sr-only">
        <table>
          <caption>{CHART_TITLE}, by day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">{CHART_KEY.toOffer}</th>
              <th scope="col">{CHART_KEY.offered}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{datePartsOfDay(d.date).long}</th>
                <td>{d.toOffer}</td>
                <td>{d.offered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
