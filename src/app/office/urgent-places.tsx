"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FocusItem } from "@/lib/office/dashboard-home";
import { placesFreeText } from "@/lib/office/focus-copy";
import { textLink } from "../ui/classes";
import { Icon } from "../ui/icons";
import { DateTile, Seats } from "../ui/sign";
import { ShiftActions } from "./shift-actions";

// The dashboard's urgent places (Phase 20; docs/screens.md `/office`): every one the list holds,
// soonest first, each a row lifted off its panel: its date tile, time, role and where; its seats
// and who it was offered to; then "Offer to someone" and "…" (named apart by `labels`, one per
// place). A place that leaves (marked not urgent) takes its row with it, so the answers show as a
// confirmation at the foot of the screen for 3 seconds (as Phase 18's Next up did), not in the row.
export function UrgentPlaces({ items, labels }: { items: FocusItem[]; labels: string[] }) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <>
      <ul role="list" className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li
            key={item.shiftId}
            data-urgent-place=""
            className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-3.5 shadow-lift sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3.5">
              <DateTile
                dow={item.dow}
                day={item.day}
                month={item.month}
                urgent
                label={item.dateLong}
              />
              <div className="min-w-0">
                <p className="font-sign text-lg leading-tight">{item.range}</p>
                <p className="font-medium">
                  <Link href={`/office/shifts/${item.shiftId}`} className={textLink}>
                    {item.role}
                  </Link>
                </p>
                <p className="text-sm text-ink-muted">{item.where}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Seats taken={item.headcount - item.placesLeft} total={item.headcount} urgent />
                  <span className="tabular-nums">
                    {placesFreeText(item.placesLeft, item.headcount)}
                  </span>
                  <span
                    className={
                      item.notOffered ? "font-semibold text-attention-ink" : "text-ink-muted"
                    }
                  >
                    · {item.notOffered ? "Not offered yet" : item.offered}
                  </span>
                </p>
                {item.escalated && (
                  <p className="text-sm text-ink-muted">The office was emailed about it.</p>
                )}
                {item.hidden && (
                  <p className="mt-1 text-sm font-semibold text-urgent">{item.hidden}</p>
                )}
                {(item.fromSheet || item.fromPlanner) && (
                  <p className="mt-1 text-sm text-ink-muted">
                    {item.fromSheet ? "From your Google Sheet" : "From your planner"}: change its
                    places there.
                  </p>
                )}
              </div>
            </div>
            <ShiftActions
              shiftId={item.shiftId}
              isUrgent
              fromSheet={item.fromSheet}
              fromPlanner={item.fromPlanner}
              className="shrink-0"
              more={labels[i]}
              onMessage={setToast}
            />
          </li>
        ))}
      </ul>
      {toast && (
        <p
          role="status"
          className="fixed bottom-6 left-1/2 z-30 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 animate-toast items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 font-medium text-on-ink shadow-panel"
        >
          <Icon name="check" size={18} />
          {toast}
        </p>
      )}
    </>
  );
}
