"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FocusItem } from "@/lib/office/dashboard-home";
import { placesFilledText } from "@/lib/office/focus-copy";
import { Icon } from "../ui/icons";
import { ShiftActions } from "./shift-actions";

// The dashboard's urgent places (Phases 20 and 21; docs/screens.md `/office`): every one the list
// holds, soonest first, in one rounded white list with hairlines that start at the words (Apple
// Wallet's): a neutral date tile; the role (a link to the session) and, in grey, where and when;
// a slim bar of the places filled with "3 of 4 filled"; who it was offered to, or "Not offered
// yet" in red; then "Offer" and "…" (named apart by `labels`, one per place). A place that leaves
// (marked not urgent) takes its row with it, so the answers show as a confirmation at the foot of
// the screen for 3 seconds (as Phase 18's Next up did), not in the row. Phase 22 (round 2): the date
// tile a small calendar page raised off the list, its day on a red band (every place here is
// urgent); the bar set in a groove; a red dot before "Not offered yet".
export function UrgentPlaces({ items, labels }: { items: FocusItem[]; labels: string[] }) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <>
      <ul role="list" className="rounded-card bg-card shadow-soft">
        {items.map((item, i) => {
          const filled = Math.max(0, item.headcount - item.placesLeft);
          const share = item.headcount > 0 ? Math.round((filled / item.headcount) * 100) : 0;
          return (
            <li key={item.shiftId} data-urgent-place="" className="group/row flex gap-4 pl-4">
              <span
                role="img"
                aria-label={item.dateLong}
                className="my-3 flex w-13 shrink-0 flex-col self-start overflow-hidden rounded-row bg-card text-center shadow-raise"
              >
                <span className="flex h-5 items-center justify-center bg-urgent-fill text-xs font-semibold tracking-wider text-on-urgent uppercase">
                  {item.dow}
                </span>
                <span className="pt-1 font-stat text-lg leading-5 text-ink">{item.day}</span>
                <span className="pb-1 text-xs leading-4 text-ink-muted">{item.month}</span>
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3 border-t border-line py-3 pr-4 group-first/row:border-t-0 md:flex-row md:flex-wrap md:items-start lg:flex-nowrap lg:items-center lg:gap-6">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    <Link
                      href={`/office/shifts/${item.shiftId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {item.role}
                    </Link>
                  </p>
                  <p className="text-sm text-ink-muted">{item.where}</p>
                  <p className="text-sm text-ink-muted tabular-nums">{item.range}</p>
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
                {/* Under the words on a phone and a tablet (the buttons beside them from 768px);
                    from 1024px, columns of the row. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:order-last md:w-full lg:contents">
                  <div className="flex w-40 flex-col gap-1">
                    <span
                      aria-hidden="true"
                      className="block h-2 w-full overflow-hidden rounded-full bg-raised inset-shadow-sunk"
                    >
                      <span
                        className="block h-full rounded-full bg-ink"
                        style={{ width: `${share}%` }}
                      />
                    </span>
                    <span className="text-sm text-ink-muted tabular-nums">
                      {placesFilledText(item.placesLeft, item.headcount)}
                    </span>
                  </div>
                  <p
                    className={`flex items-center gap-2 text-sm lg:w-40 ${
                      item.notOffered ? "font-semibold text-urgent" : "text-ink-muted"
                    }`}
                  >
                    {item.notOffered && (
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full bg-urgent-fill"
                      />
                    )}
                    {item.notOffered ? "Not offered yet" : item.offered}
                  </p>
                </div>
                <ShiftActions
                  shiftId={item.shiftId}
                  isUrgent
                  fromSheet={item.fromSheet}
                  fromPlanner={item.fromPlanner}
                  className="shrink-0 md:order-2"
                  more={labels[i]}
                  onMessage={setToast}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-6 z-30 mx-auto flex max-w-md animate-toast items-center gap-3 rounded-row bg-ink px-4 py-3 font-medium text-on-ink shadow-float"
        >
          <Icon name="check" size={18} />
          {toast}
        </p>
      )}
    </>
  );
}
