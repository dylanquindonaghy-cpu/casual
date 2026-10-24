"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FocusItem } from "@/lib/office/dashboard-home";
import { placesFilledText } from "@/lib/office/focus-copy";
import { btn } from "../ui/classes";
import { Icon } from "../ui/icons";
import { StatusChip } from "../ui/status-chip";
import { ShiftActions } from "./shift-actions";

// The dashboard's urgent places (Phases 20 to 23; docs/screens.md `/office`): every one the list
// holds, soonest first. Phase 23 (round 3, the approved mock-up): each a white card with its
// hairline (one to a row on a phone, two from 1024px, three from 1280px): its day and times in an
// outlined chip; the role (a link to the session) and its event and site; its chips (urgent, and
// not offered yet, or who it was offered to); the office emailed, hidden from casuals, a sheet's
// or a planner's place where they apply; a slim bar of the places filled ("1 of 3 filled"); then a
// wide "Offer" and "…" (named apart by `labels`, one per place). A place that leaves (marked not
// urgent) takes its card with it, so the answers show as a confirmation at the foot of the screen
// for 3 seconds, not in the card; with none left, the list says so here, so that confirmation
// stays.
export function UrgentPlaces({ items, labels }: { items: FocusItem[]; labels: string[] }) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <>
      {items.length > 0 ? (
        <ul role="list" className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item, i) => {
            const filled = Math.max(0, item.headcount - item.placesLeft);
            const share = item.headcount > 0 ? Math.round((filled / item.headcount) * 100) : 0;
            const stopped = item.offered.startsWith("Offers stopped");
            return (
              <li
                key={item.shiftId}
                data-urgent-place=""
                className="flex min-w-0 flex-col gap-4 rounded-inner border border-line bg-card p-4 sm:p-6"
              >
                <p className="inline-flex min-h-7 w-fit items-center gap-2 rounded-full border border-button-line px-3 text-sm font-semibold text-ink-muted tabular-nums">
                  <Icon name="shifts" size={16} />
                  <span role="img" aria-label={item.dateLong}>
                    {item.dow} {item.day} {item.month}
                  </span>
                  {` · ${item.range}`}
                </p>
                <div className="min-w-0">
                  <h3 className="text-2xl font-bold tracking-heading text-ink">
                    <Link
                      href={`/office/shifts/${item.shiftId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {item.role}
                    </Link>
                  </h3>
                  <p className="mt-1 text-base text-ink-muted">{item.where}</p>
                </div>
                <p className="flex flex-wrap gap-2">
                  <StatusChip tone="urgent">Urgent</StatusChip>
                  {item.notOffered ? (
                    <StatusChip tone="attention">Not offered yet</StatusChip>
                  ) : (
                    <StatusChip tone={stopped ? "quiet" : "wait"}>{item.offered}</StatusChip>
                  )}
                </p>
                {(item.escalated || item.hidden || item.fromSheet || item.fromPlanner) && (
                  <div className="flex flex-col gap-1 text-sm">
                    {item.escalated && (
                      <p className="text-ink-muted">The office was emailed about it.</p>
                    )}
                    {item.hidden && <p className="font-semibold text-urgent">{item.hidden}</p>}
                    {(item.fromSheet || item.fromPlanner) && (
                      <p className="text-ink-muted">
                        {item.fromSheet ? "From your Google Sheet" : "From your planner"}: change
                        its places there.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <span
                    aria-hidden="true"
                    className="block h-2 w-full overflow-hidden rounded-full border border-line bg-raised"
                  >
                    <span
                      className="block h-full rounded-full bg-accent-press"
                      style={{ width: `${share}%` }}
                    />
                  </span>
                  <span className="text-sm text-ink-muted tabular-nums">
                    {placesFilledText(item.placesLeft, item.headcount)}
                  </span>
                </div>
                <ShiftActions
                  shiftId={item.shiftId}
                  isUrgent
                  fromSheet={item.fromSheet}
                  fromPlanner={item.fromPlanner}
                  className="mt-auto"
                  more={labels[i]}
                  onMessage={setToast}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-4 rounded-inner border border-line bg-card p-4 sm:p-6">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-row bg-done-tile text-done-ink"
          >
            <Icon name="check" size={24} />
          </span>
          <div className="min-w-48 flex-1">
            <p className="text-lg font-semibold">Every urgent place is filled.</p>
            <p className="text-ink-muted">Nobody needs finding right now.</p>
          </div>
          <Link href="/office/events" className={btn.secondary}>
            See events
          </Link>
        </div>
      )}
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
