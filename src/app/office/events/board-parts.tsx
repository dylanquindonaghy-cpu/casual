import type { BoardDay } from "@/lib/office/events-board";

// Two parts of the rota board (Phase 20; docs/screens.md `/office/events`), apart from the page so
// they can be rendered on their own: the key under the filters and dates, in plain words, and the
// row of day headers (today with a bar along its top: the firm's colour until Phase 21, ink in the
// office now; weekends a shade darker, as their cells are in each event's row).

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
        <span aria-hidden="true" className="h-3 w-5 rounded-full bg-raised" />
        Full
      </span>
      <span>Pills show places filled out of places needed.</span>
    </p>
  );
}

export function BoardDays({ days }: { days: BoardDay[] }) {
  return (
    <div className="grid grid-cols-[16rem_repeat(14,minmax(0,1fr))] border-b border-line">
      <div className="flex items-center px-4 py-2 text-sm text-ink-muted">Event</div>
      {days.map((d) => (
        <div
          key={d.date}
          data-day={d.date}
          className={`relative flex flex-col items-center justify-center py-2 leading-tight ${d.weekend ? "bg-canvas" : ""}`}
        >
          {/* Today: a bar along its top. */}
          {d.today && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand" />}
          <div className="text-base font-semibold tabular-nums">{d.day}</div>
          <div className={`text-xs ${d.today ? "font-semibold text-ink" : "text-ink-muted"}`}>
            {d.dow}
          </div>
        </div>
      ))}
    </div>
  );
}
