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
import {
  ALL_DATES,
  PICK_A_DAY,
  dateChoiceLabel,
  dayChoice,
  MY_CONTRACTS,
  NO_CONTRACT_VENUES,
  SHOW_EVERYTHING,
} from "@/lib/office/customise-copy";
import { dayMonthLabel } from "@/lib/office/dashboard-cards-copy";
import { readCards } from "@/lib/office/dashboard-cards";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { notice, tab, tabCount, tabCurrent, tabs } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Board } from "./dashboard/board";
import { ExtraCards } from "./dashboard/extra-cards";
import { CustomiseButton } from "./customise-panel";

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
  const me = board.me.ok ? board.me.data : null;
  const hasContracts = (me?.clientIds.length ?? 0) > 0;
  const view: BoardView = {
    show: board.show,
    full: board.full,
    role: board.role,
    day: board.day,
    everything: hasContracts && !board.mine,
  };
  const roles = board.roles.ok ? board.roles.data : [];
  const days = board.days.ok ? board.days.data : [];
  const cards = me?.cards ?? readCards(undefined);
  return (
    <div className="@container flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* Its "Updated 10:42" beside it (aud-2: ./updated-stamp.tsx). */}
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-title text-ink">Dashboard</h1>
            <small data-updated-slot="" className="text-xs text-ink-faint tabular-nums" />
          </div>
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
        {/* Customise and the date choice (Phase 26.3: dash-7, cus-5). */}
        <div className="flex flex-wrap items-center gap-2">
          {me && <CustomiseButton me={me} />}
          {days.length > 0 && (
            <details key={board.day ?? "all"} className="group relative">
              <summary
                aria-label={dateChoiceLabel(board.day)}
                className={`press-glass glass-button inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-4 text-sm font-medium hover:bg-button-hover active:bg-button-press [&::-webkit-details-marker]:hidden ${board.day ? "text-ink" : "text-ink-muted"}`}
              >
                {board.day ? dayMonthLabel(board.day) : PICK_A_DAY}
                <Icon
                  name="chevron"
                  size={16}
                  className="rotate-90 transition-transform duration-150 ease-sd group-open:-rotate-90 motion-reduce:transition-none"
                />
              </summary>
              <ul
                role="list"
                className="glass-float absolute top-full right-0 z-30 mt-2 flex max-h-80 w-64 flex-col gap-1 overflow-y-auto rounded-inner p-2"
              >
                {[null, ...days].map((d) => (
                  <li key={d?.date ?? "all"}>
                    <Link
                      href={boardHref({ ...view, day: d?.date ?? null })}
                      scroll={false}
                      aria-current={(d?.date ?? null) === board.day ? "true" : undefined}
                      className={`press flex min-h-11 items-center rounded-row px-3 tabular-nums hover:bg-active ${(d?.date ?? null) === board.day ? "font-semibold text-ink" : "text-ink-muted"}`}
                    >
                      {d ? dayChoice(d) : ALL_DATES}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </header>
      {/* Under the headline (round 8): the track, Filter and Show filled venues too. */}
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
          <details key={board.role ?? "every"} className="group relative">
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
        {/* My contracts (Phase 26.3, cus-2): on, only the person's contracts; off, everything. */}
        {hasContracts && (
          <Link
            href={boardHref({ ...view, everything: board.mine })}
            scroll={false}
            role="switch"
            aria-checked={board.mine}
            className="press @min-[48rem]:ml-auto inline-flex min-h-11 items-center gap-3 rounded-full px-2 text-sm text-ink-muted hover:text-ink"
          >
            {MY_CONTRACTS}
            <span
              aria-hidden="true"
              className={`inline-flex h-6 w-10 items-center rounded-full p-1 transition-colors ${board.mine ? "bg-accent" : "bg-switch-off"}`}
            >
              <span
                className={`size-4 rounded-full bg-knob transition-transform duration-150 ease-sd motion-reduce:transition-none ${board.mine ? "translate-x-4" : "translate-x-0"}`}
              />
            </span>
          </Link>
        )}
        <Link
          href={boardHref({ ...view, full: !board.full })}
          scroll={false}
          role="switch"
          aria-checked={board.full}
          className={`press inline-flex min-h-11 items-center gap-3 rounded-full px-2 text-sm text-ink-muted hover:text-ink ${hasContracts ? "" : "@min-[48rem]:ml-auto"}`}
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
      {board.mine && me?.sites?.length === 0 && (
        <p role="status" className={`${notice} flex flex-wrap items-center gap-x-3 gap-y-2`}>
          <Icon name="info" size={18} />
          <span className="min-w-0 flex-1">{NO_CONTRACT_VENUES}</span>
          <Link
            href={boardHref({ ...view, everything: true })}
            scroll={false}
            className="font-medium text-ink underline underline-offset-2"
          >
            {SHOW_EVERYTHING}
          </Link>
        </p>
      )}
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
        cards={cards}
      />
      <ExtraCards board={board} />
    </div>
  );
}
