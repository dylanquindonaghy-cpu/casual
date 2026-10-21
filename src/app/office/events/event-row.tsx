"use client";

import { useState, type ReactNode } from "react";
import type { Pill, PillTone } from "@/lib/office/events-board";
import { Icon } from "../../ui/icons";

// One event's row on the rota board (Phase 18): its name and its line (open places, urgent gaps,
// hidden), its "show to casuals" switch, then its sessions as pills on their days. The name and
// each pill open the row in place into the event's sessions (`panel`, drawn by the server: the
// table, its switches and menus); the arrow turns as it opens.

const PILL: Record<PillTone, string> = {
  urgent: "bg-urgent-fill text-on-urgent",
  open: "border-[1.5px] border-ink bg-card text-ink",
  full: "bg-raised text-ink-muted",
};

export function EventRow({
  eventId,
  name,
  note,
  urgent,
  hidden,
  showingSwitch,
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
  showingSwitch: ReactNode;
  cells: Pill[][];
  weekend: boolean[];
  panel: ReactNode;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `event-${eventId}-sessions`;
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={`${first ? "" : "border-t border-line"} ${open ? "bg-canvas" : ""}`}>
      <div className="grid grid-cols-[18rem_repeat(14,minmax(0,1fr))] items-stretch">
        <div className="flex min-w-0 items-center gap-2 py-2 pr-2.5 pl-1.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-quiet-soft"
          >
            <Icon
              name="chevron"
              size={16}
              className={`text-ink-muted transition-transform duration-200 ease-sd ${open ? "rotate-90" : ""}`}
            />
            <span className="min-w-0">
              <span className={`block truncate font-semibold ${hidden ? "text-ink-muted" : ""}`}>
                {name}
              </span>
              <span
                className={`block truncate text-sm ${urgent ? "font-semibold text-urgent" : "text-ink-muted"}`}
              >
                {note}
              </span>
            </span>
          </button>
          {showingSwitch}
        </div>
        {cells.map((pills, i) => (
          <div
            key={i}
            className={`flex flex-col justify-center gap-[3px] border-l border-line px-[3px] py-1.5 ${weekend[i] ? "bg-canvas" : ""}`}
          >
            {pills.map((p) => (
              <button
                key={p.shiftId}
                type="button"
                aria-label={p.label}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={toggle}
                className={`flex flex-col items-center ${hidden ? "opacity-50" : ""}`}
              >
                <span
                  className={`flex h-6 w-full items-center justify-center rounded font-sign text-base ${PILL[p.tone]}`}
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
        {open && <div className="mx-3 mb-3.5 ml-8.5 animate-in">{panel}</div>}
      </div>
    </div>
  );
}
