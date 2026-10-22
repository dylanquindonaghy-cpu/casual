import type { BoardDay } from "@/lib/office/events-board";

// Two parts of the rota board (Phase 20; docs/screens.md `/office/events`), apart from the page so
// they can be rendered on their own: the key under the filters and dates, in plain words, and the
// row of day headers (today with a bar in the firm's colour along its top, weekends a shade
// darker, as their cells are in each event's row).

export function BoardKey() {
  return (
    <p
      data-board-key=""
      className="-mt-1 flex flex-wrap gap-x-4.5 gap-y-1.5 text-sm text-ink-muted"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3.5 rounded-[4px] bg-urgent-fill" />
        Urgent gap
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3.5 rounded-[4px] border-[1.5px] border-ink-muted"
        />
        Places open
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3.5 rounded-[4px] bg-raised" />
        Full
      </span>
      <span>Pills show places filled out of places needed.</span>
    </p>
  );
}

export function BoardDays({ days }: { days: BoardDay[] }) {
  return (
    <div className="grid grid-cols-[16rem_repeat(14,minmax(0,1fr))] border-b border-line">
      <div className="flex items-center px-5 py-2 text-sm text-ink-muted">Event</div>
      {days.map((d) => (
        <div
          key={d.date}
          data-day={d.date}
          className={`relative flex flex-col items-center justify-center py-2 leading-tight ${d.weekend ? "bg-canvas" : ""}`}
        >
          {/* Today: a bar in the firm's colour along its top. */}
          {d.today && (
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-brand" />
          )}
          <div className="font-sign text-base">{d.day}</div>
          <div className={`text-xs ${d.today ? "font-semibold text-ink" : "text-ink-muted"}`}>
            {d.dow}
          </div>
        </div>
      ))}
    </div>
  );
}
