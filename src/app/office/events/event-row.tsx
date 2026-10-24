"use client";

import { useState, type ReactNode } from "react";
import type { Pill, PillTone } from "@/lib/office/events-board";
import { Icon } from "../../ui/icons";

// One event's row on the rota board (Phases 18 and 20): its name in full (on two lines when it
// needs them) and its line (open places, urgent gaps; "Hidden from casuals" with its mark), then
// its sessions as pills on their days. No switch on the row (Phase 20): "show to casuals" is in
// the opened row, so a slip can't hide an event. The name and each pill open the row in place
// into the event's sessions (`panel`, drawn by the server: its switch, the table, its switches
// and menus), set into the board a step darker; the arrow turns as it opens. The name and the
// pills dip when pressed, as everything you press (Phase 22). Phase 23 (the approved mock-up): an
// urgent gap a solid red pill, open places a white pill with a grey outline, full a light grey one
// with its hairline (so it still shows on a weekend's grey); weekends a light grey.

const PILL: Record<PillTone, string> = {
  urgent: "bg-urgent-fill text-on-urgent",
  open: "border border-ink-muted bg-card text-ink",
  full: "border border-line bg-raised text-ink-muted",
};

export function EventRow({
  eventId,
  name,
  note,
  urgent,
  hidden,
  cells,
  weekend,
  panel,
  first,
}: {
  eventId: string;
  name: string;
  note: string;
  urgent: boolean;
  hidden: boolean;
  cells: Pill[][];
  weekend: boolean[];
  panel: ReactNode;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `event-${eventId}-sessions`;
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={first ? "" : "border-t border-line"}>
      <div className="grid grid-cols-[16rem_repeat(14,minmax(0,1fr))] items-stretch">
        <div className="flex min-h-16 min-w-0 items-center gap-2 p-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            className="press flex min-w-0 flex-1 items-center gap-2 rounded-row px-2 py-1 text-left hover:bg-quiet-soft active:bg-button-press"
          >
            <Icon
              name="chevron"
              size={16}
              className={`text-ink-muted transition-transform duration-200 ease-sd ${open ? "rotate-90" : ""}`}
            />
            <span className="min-w-0">
              <span
                className={`block leading-snug font-semibold break-words ${hidden ? "text-ink-muted" : ""}`}
              >
                {name}
              </span>
              <span
                className={`flex items-center gap-1 text-sm ${urgent ? "font-semibold text-urgent-ink" : "text-ink-muted"}`}
              >
                {hidden && <Icon name="hidden" size={15} />}
                {note}
              </span>
            </span>
          </button>
        </div>
        {cells.map((pills, i) => (
          <div
            key={i}
            className={`flex flex-col justify-center gap-1 px-1 py-2 ${weekend[i] ? "bg-raised" : ""}`}
          >
            {pills.map((p) => (
              <button
                key={p.shiftId}
                type="button"
                aria-label={p.label}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={toggle}
                className={`press flex flex-col items-center ${hidden ? "opacity-50" : ""}`}
              >
                <span
                  className={`flex h-7 w-full items-center justify-center rounded-full text-sm font-bold tabular-nums ${PILL[p.tone]}`}
                >
                  {p.text}
                </span>
                {p.sessions && (
                  <span className="text-xs leading-tight text-ink-muted">×{p.sessions}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div id={panelId} hidden={!open}>
        {open && <div className="mx-3 mb-4 animate-in">{panel}</div>}
      </div>
    </div>
  );
}
