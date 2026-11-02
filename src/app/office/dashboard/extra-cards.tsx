import type { ReactNode } from "react";
import type { Board } from "@/lib/office/dashboard-board";
import {
  CANCELLATIONS_CARD,
  cancellationsSummary,
  dayLabel,
  FILL_RATE_CARD,
  fillLine,
  fillPercent,
  NEXT_TWO_WEEKS,
  nextTwoWeeksSummary,
  NO_SHOWS_CARD,
  noShowsSummary,
  SHOW_TABLE,
  weekLabel,
} from "@/lib/office/dashboard-cards-copy";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import type { Part } from "@/lib/office/dashboard";
import { notice } from "../../ui/classes";
import { Icon } from "../../ui/icons";

// The dashboard's extra cards (Phase 26.3; the spec page's cus-3, the pre-build audit's aud-9,
// aud-10 and aud-13), each shown only when its person chose it under Customise: Next 2 weeks,
// Cancellations, No-shows and Fill rate. Each says where its figures come from and when, draws
// them as plain bars (decorative: the sentence under the title says it in words), keeps its
// figures as a table one tap away, and says what will show there when it's empty. The figures
// are the loader's (src/lib/office/dashboard-cards-data.ts), counted by code from the firm's own
// records; the words are src/lib/office/dashboard-cards-copy.ts's.

const pct = (n: number, top: number) => `${top === 0 ? 0 : Math.round((n / top) * 100)}%`;

function Card({
  id,
  title,
  source,
  summary,
  failed,
  empty,
  children,
  table,
}: {
  id: string;
  title: string;
  source: string;
  summary: string;
  failed: boolean;
  empty: string | null; // its words when there's nothing to show
  children: ReactNode; // the bars
  table: { heads: readonly string[]; rows: (string | number)[][] };
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="glass min-w-0 rounded-inner p-4">
      <h2 id={`${id}-title`} className="px-1 text-lg font-semibold tracking-heading text-ink">
        {title}
      </h2>
      <p className="mt-1 px-1 text-xs text-ink-faint">{source}</p>
      {failed ? (
        <p role="status" className={`${notice} mt-3 flex items-start gap-2`}>
          <Icon name="info" size={18} className="mt-1" />
          {SECTION_ERROR}
        </p>
      ) : empty ? (
        <p className="mt-3 rounded-row glass-tile p-4 text-sm text-ink-muted">{empty}</p>
      ) : (
        <>
          <p className="mt-2 px-1 text-sm text-ink-muted">{summary}</p>
          <div aria-hidden="true" className="mt-3">
            {children}
          </div>
          <details className="group mt-2 px-1">
            <summary className="press inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-row text-sm text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
              {SHOW_TABLE}
              <Icon
                name="chevron"
                size={16}
                className="rotate-90 transition-transform duration-150 ease-sd group-open:-rotate-90 motion-reduce:transition-none"
              />
            </summary>
            <table className="mt-1 w-full text-left text-sm tabular-nums">
              <caption className="sr-only">{title}</caption>
              <thead className="text-xs text-ink-faint">
                <tr className="border-b border-line">
                  {table.heads.map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`py-2 font-medium ${i > 0 ? "pl-3 text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.rows.map((r) => (
                  <tr key={String(r[0])}>
                    {r.map((cell, i) =>
                      i === 0 ? (
                        <th key={i} scope="row" className="py-2 font-normal text-ink">
                          {cell}
                        </th>
                      ) : (
                        <td key={i} className="py-2 pl-3 text-right text-ink-muted">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

// Stacked bars from the foot, one a column, with its label under it; and the key.
function Bars({
  columns,
  legend,
}: {
  columns: { label: string; parts: { n: number; cls: string }[] }[];
  legend: { label: string; cls: string }[];
}) {
  const top = Math.max(1, ...columns.map((c) => c.parts.reduce((t, p) => t + p.n, 0)));
  return (
    <>
      <ul role="list" className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-ink-muted">
        {legend.map((k) => (
          <li key={k.label} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${k.cls}`} />
            {k.label}
          </li>
        ))}
      </ul>
      <div className="flex h-32 items-end gap-1 border-b border-line">
        {columns.map((c) => (
          <span key={c.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {c.parts
              .filter((p) => p.n > 0)
              .reverse()
              .map((p, i) => (
                <span
                  key={i}
                  className={`block w-full ${p.cls}`}
                  style={{ height: pct(p.n, top) }}
                />
              ))}
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-center text-xs leading-tight text-ink-faint">
        {columns.map((c, i) => (
          // Past 8 columns every other one is blank, so a label may spread into its neighbours.
          <span key={c.label} className="flex min-w-0 flex-1 justify-center whitespace-nowrap">
            {columns.length > 8 && i % 2 === 1 ? "" : c.label}
          </span>
        ))}
      </div>
    </>
  );
}

const failedOf = <T,>(p: Part<T> | null): boolean => p !== null && !p.ok;
const dataOf = <T,>(p: Part<T> | null): T | null => (p?.ok ? p.data : null);

export function ExtraCards({
  board,
}: {
  board: Pick<Board, "nextTwoWeeks" | "cancelWeeks" | "noShowWeeks" | "fillRates">;
}) {
  const next = dataOf(board.nextTwoWeeks);
  const cancels = dataOf(board.cancelWeeks);
  const noShows = dataOf(board.noShowWeeks);
  const fill = dataOf(board.fillRates);
  const any = [board.nextTwoWeeks, board.cancelWeeks, board.noShowWeeks, board.fillRates].some(
    (p) => p !== null,
  );
  if (!any) return null;
  return (
    <div className="grid items-start gap-3 @min-[48rem]:grid-cols-2">
      {board.nextTwoWeeks !== null && (
        <Card
          id="next-two-weeks"
          title={NEXT_TWO_WEEKS.title}
          source={NEXT_TWO_WEEKS.source}
          summary={next ? nextTwoWeeksSummary(next) : ""}
          failed={failedOf(board.nextTwoWeeks)}
          empty={
            next && next.every((d) => d.booked + d.offered + d.open === 0)
              ? NEXT_TWO_WEEKS.empty
              : null
          }
          table={{
            heads: NEXT_TWO_WEEKS.heads,
            rows: (next ?? []).map((d) => [dayLabel(d.date), d.booked, d.offered, d.open]),
          }}
        >
          <Bars
            legend={[
              { label: NEXT_TWO_WEEKS.key.booked, cls: "bg-mark-done" },
              { label: NEXT_TWO_WEEKS.key.offered, cls: "bg-mark-wait" },
              { label: NEXT_TWO_WEEKS.key.open, cls: "bg-mark-open" },
            ]}
            columns={(next ?? []).map((d) => ({
              label: dayLabel(d.date),
              parts: [
                { n: d.booked, cls: "bg-mark-done" },
                { n: d.offered, cls: "bg-mark-wait" },
                { n: d.open, cls: "bg-mark-open" },
              ],
            }))}
          />
        </Card>
      )}
      {board.cancelWeeks !== null && (
        <Card
          id="cancellations-by-week"
          title={CANCELLATIONS_CARD.title}
          source={CANCELLATIONS_CARD.source}
          summary={cancels ? cancellationsSummary(cancels) : ""}
          failed={failedOf(board.cancelWeeks)}
          empty={
            cancels && cancels.every((w) => w.short + w.longer === 0)
              ? CANCELLATIONS_CARD.empty
              : null
          }
          table={{
            heads: CANCELLATIONS_CARD.heads,
            rows: (cancels ?? []).map((w) => [weekLabel(w.week), w.short, w.longer]),
          }}
        >
          <Bars
            legend={[
              { label: CANCELLATIONS_CARD.key.short, cls: "bg-mark-urgent" },
              { label: CANCELLATIONS_CARD.key.longer, cls: "bg-mark-calm" },
            ]}
            columns={(cancels ?? []).map((w) => ({
              label: weekLabel(w.week),
              parts: [
                { n: w.short, cls: "bg-mark-urgent" },
                { n: w.longer, cls: "bg-mark-calm" },
              ],
            }))}
          />
        </Card>
      )}
      {board.noShowWeeks !== null && (
        <Card
          id="no-shows-by-week"
          title={NO_SHOWS_CARD.title}
          source={NO_SHOWS_CARD.source}
          summary={noShows ? noShowsSummary(noShows) : ""}
          failed={failedOf(board.noShowWeeks)}
          empty={noShows && noShows.every((w) => w.noShows === 0) ? NO_SHOWS_CARD.empty : null}
          table={{
            heads: NO_SHOWS_CARD.heads,
            rows: (noShows ?? []).map((w) => [weekLabel(w.week), w.noShows]),
          }}
        >
          <Bars
            legend={[{ label: NO_SHOWS_CARD.title, cls: "bg-mark-urgent" }]}
            columns={(noShows ?? []).map((w) => ({
              label: weekLabel(w.week),
              parts: [{ n: w.noShows, cls: "bg-mark-urgent" }],
            }))}
          />
        </Card>
      )}
      {board.fillRates !== null && (
        <Card
          id="fill-rate"
          title={FILL_RATE_CARD.title}
          source={FILL_RATE_CARD.source}
          summary={(fill ?? []).map(fillLine).join(" ")}
          failed={failedOf(board.fillRates)}
          empty={fill && fill.length === 0 ? FILL_RATE_CARD.empty : null}
          table={{
            heads: FILL_RATE_CARD.heads,
            rows: (fill ?? []).map((f) => [
              f.name ?? FILL_RATE_CARD.none,
              f.booked,
              f.needed,
              `${fillPercent(f)}%`,
            ]),
          }}
        >
          <ul role="list" className="flex flex-col gap-3">
            {(fill ?? []).map((f) => (
              <li key={f.clientId ?? "none"} className="flex flex-col gap-1">
                <span className="flex justify-between gap-3 text-sm">
                  <span className="truncate text-ink">{f.name ?? FILL_RATE_CARD.none}</span>
                  <span className="text-ink-muted tabular-nums">{fillPercent(f)}%</span>
                </span>
                <span className="block h-2 overflow-hidden rounded-full bg-raised">
                  <span
                    className="block h-full rounded-full bg-mark-done"
                    style={{ width: `${fillPercent(f)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
