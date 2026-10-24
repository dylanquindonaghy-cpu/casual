import type { BoardDay } from "@/lib/office/events-board";

// Two parts of the rota board (Phase 20; docs/screens.md `/office/events`), apart from the page so
// they can be rendered on their own: the key under the filters and dates, in plain words, and the
// row of day headers. Phase 23 (the approved mock-up): today's date in a sky circle (`accent`, its
// near-black words), "Today" under it in bold; weekends a light grey (`raised`), as their cells
// are in each event's row.

export function BoardKey() {
  return (
    <p data-board-key="" className="-mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-muted">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-5 rounded-full bg-urgent-fill" />
        Urgent gap
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-5 rounded-full border border-ink-muted bg-card" />
        Places open
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-5 rounded-full border border-line bg-raised" />
        Full
      </span>
      <span>Pills show places filled out of places needed.</span>
    </p>
  );
}

export function BoardDays({ days }: { days: BoardDay[] }) {
  return (
    <div className="grid grid-cols-[16rem_repeat(14,minmax(0,1fr))] border-b border-line">
      <div className="flex items-end px-4 py-3 text-sm font-semibold text-ink-muted">Event</div>
      {days.map((d) => (
        <div
          key={d.date}
          data-day={d.date}
          className={`flex flex-col items-center justify-center gap-1 py-2 leading-tight ${d.weekend ? "bg-raised" : ""}`}
        >
          {/* The date; today's in a sky circle. */}
          <span
            className={`flex size-8 items-center justify-center rounded-full text-lg font-bold tabular-nums ${d.today ? "bg-accent text-on-accent" : "text-ink"}`}
          >
            {d.day}
          </span>
          <div className={`text-xs ${d.today ? "font-semibold text-ink" : "text-ink-muted"}`}>
            {d.dow}
          </div>
        </div>
      ))}
    </div>
  );
}
