import Link from "next/link";
import { BOARD_SHOWS, type Board as BoardData } from "@/lib/office/dashboard-board";
import {
  boardHref,
  EVERY_ROLE,
  FILTER,
  filterLabel,
  headLine,
  SHOW_WORDS,
  type BoardView,
} from "@/lib/office/board-copy";
import { roleLabel } from "@/lib/portal/format";
import { FULL_VENUES } from "@/lib/office/dashboard-map-copy";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { notice, tab, tabCount, tabCurrent, tabs } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Board } from "./dashboard/board";

// The office dashboard (Phase 24, 24.3; round 8 since Phase 26.2: the spec page's "Dashboard",
// docs/mockups/round-8/; docs/screens.md `/office`), one question: "which places still need people,
// and what happened while I was out?". "Dashboard" with the day, the pay week and its pay day, and
// when the planner or rota sheet last sent changes; under it the track (All, Urgent, This week, Next
// week: the sessions with places to fill, each a link that keeps the page and changes the board)
// and "Show full venues" (the map's venues with nothing to fill too). Then the venue map with the
// chosen session's card on it, and the board's three columns (./dashboard/board.tsx). Pure: the page
// loads the data (src/lib/office/dashboard-board.ts) and src/lib/office/board-copy.ts and
// dashboard-map-copy.ts say it in words.

export function DashboardContent({ board, tiles }: { board: BoardData; tiles: string | null }) {
  const counts = board.counts.ok ? board.counts.data : null;
  const view: BoardView = { show: board.show, full: board.full, role: board.role };
  const roles = board.roles.ok ? board.roles.data : [];
  return (
    <div className="@container flex flex-col gap-6">
      <header>
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
      </header>
      {/* Under the headline (round 8): the track, Filter and Show full venues. */}
      <div className="-mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* The sessions with places to fill: one row that scrolls sideways inside its track on a
              phone, never the page. */}
        <nav aria-label="Show" className={tabs}>
          {BOARD_SHOWS.map((v) => {
            const on = v === board.show;
            return (
              <Link
                key={v}
                href={boardHref({ ...view, show: v })}
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
        {/* Filter (dash-3): one role with places to fill, or every role; a native disclosure of
              plain links, so it works before the page is ready. */}
        {roles.length > 0 && (
          <details className="group relative">
            <summary
              aria-label={filterLabel(board.role, roleLabel)}
              className={`press-glass glass-button inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-4 text-sm font-medium hover:bg-button-hover active:bg-button-press [&::-webkit-details-marker]:hidden ${board.role ? "text-ink" : "text-ink-muted"}`}
            >
              <Icon name="filter" size={16} />
              {board.role ? roleLabel(board.role) : FILTER}
            </summary>
            <ul
              role="list"
              className="glass-float absolute top-full left-0 z-30 mt-2 flex w-64 flex-col gap-1 rounded-inner p-2"
            >
              {[null, ...roles].map((r) => (
                <li key={r ?? "every"}>
                  <Link
                    href={boardHref({ ...view, role: r })}
                    scroll={false}
                    aria-current={r === board.role ? "true" : undefined}
                    className={`press flex min-h-11 items-center rounded-row px-3 hover:bg-active ${r === board.role ? "font-semibold text-ink" : "text-ink-muted"}`}
                  >
                    {r ? roleLabel(r) : EVERY_ROLE}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
        <Link
          href={boardHref({ ...view, full: !board.full })}
          scroll={false}
          role="switch"
          aria-checked={board.full}
          className="press @min-[48rem]:ml-auto inline-flex min-h-11 items-center gap-3 rounded-full px-2 text-sm text-ink-muted hover:text-ink"
        >
          {FULL_VENUES}
          <span
            aria-hidden="true"
            className={`inline-flex h-6 w-10 items-center rounded-full p-1 transition-colors ${board.full ? "bg-accent" : "bg-switch-off"}`}
          >
            <span
              className={`size-4 rounded-full bg-knob transition-transform duration-150 ease-sd motion-reduce:transition-none ${board.full ? "translate-x-4" : "translate-x-0"}`}
            />
          </span>
        </Link>
      </div>
      {!board.counts.ok && (
        <p role="status" className={`${notice} flex items-start gap-2`}>
          <Icon name="info" size={18} className="mt-1" />
          {SECTION_ERROR}
        </p>
      )}
      {/* Only what the board shows goes to the browser (the page's other parts stay here). */}
      <Board
        key={boardHref(view)}
        board={{
          show: board.show,
          now: board.now,
          timeZone: board.timeZone,
          gaps: board.gaps,
          toMark: board.toMark,
          venues: board.venues,
          takers: board.takers,
          updates: board.updates,
          whoWorked: board.whoWorked,
        }}
        view={view}
        tiles={tiles}
      />
    </div>
  );
}
