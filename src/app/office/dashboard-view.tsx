import Link from "next/link";
import { BOARD_SHOWS, type Board as BoardData } from "@/lib/office/dashboard-board";
import { headLine, SHOW_WORDS, showHref } from "@/lib/office/board-copy";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { notice, tab, tabCount, tabCurrent, tabs } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Board } from "./dashboard/board";
import { PlacesChart } from "./dashboard/places-chart";

// The office dashboard (Phase 24, 24.3: round 7 of the canvas, approved by Dylan on 26 Oct 2026:
// "Round 7 exactly, layout too"; docs/mockups/phase-24/README.md; docs/screens.md `/office`), one
// question: "which places still need people, and what happened while I was out?". "Dashboard" with
// the day, the pay week and its pay day, and when the planner or rota sheet last sent changes; on
// the right the track (All, Urgent, This week, Next week: the sessions with places to fill, each a
// link that keeps the page and changes the board). Then the places chart with the detail card
// beside it, and the board's four columns (./dashboard/board.tsx). Phase 23's four count cards,
// urgent cards and six charts gave way to it: what they led to is in the top bar's counts, the
// menu, the board and the detail card's "…". Pure: the page loads the data
// (src/lib/office/dashboard-board.ts) and src/lib/office/board-copy.ts says it in words.

export function DashboardContent({ board }: { board: BoardData }) {
  const counts = board.counts.ok ? board.counts.data : null;
  return (
    <div className="@container flex flex-col gap-6">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-title text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted tabular-nums">
            {headLine(
              board.today,
              board.planner.ok ? board.planner.data : null,
              board.now,
              board.timeZone,
              board.payCalendar,
            )}
          </p>
        </div>
        {/* The sessions with places to fill: one row that scrolls sideways inside its track on a
            phone, never the page. */}
        <nav aria-label="Show" className={`${tabs} @min-[48rem]:ml-auto`}>
          {BOARD_SHOWS.map((v) => {
            const on = v === board.show;
            return (
              <Link
                key={v}
                href={showHref(v)}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={on ? tabCurrent : tab}
              >
                {SHOW_WORDS[v]}
                {counts && " "}
                {counts && <span className={tabCount(on)}>{counts[v]}</span>}
              </Link>
            );
          })}
        </nav>
      </header>
      {!board.counts.ok && (
        <p role="status" className={`${notice} flex items-start gap-2`}>
          <Icon name="info" size={18} className="mt-1" />
          {SECTION_ERROR}
        </p>
      )}
      <Board
        key={board.show}
        board={board}
        chart={
          board.chart.ok ? (
            <PlacesChart days={board.chart.data.days} today={board.today} />
          ) : (
            <section aria-label="Places to fill" className="glass rounded-inner p-6">
              <p role="status" className={`${notice} flex items-start gap-2`}>
                <Icon name="info" size={18} className="mt-1" />
                {SECTION_ERROR}
              </p>
            </section>
          )
        }
      />
    </div>
  );
}
