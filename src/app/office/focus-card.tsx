"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FocusItem } from "@/lib/office/dashboard-home";
import { placesFreeText } from "@/lib/office/focus-copy";
import { Icon } from "../ui/icons";
import { DateTile, Seats } from "../ui/sign";
import { ShiftActions } from "./shift-actions";

// The dashboard's "Next up" (Phase 18): one urgent place at a time, on a red band with "1 of 3"
// and the way to the previous and next; its date tile, time in sign figures, role and where; its
// seats ("1 of 4 places free") and who it was offered to; then "Offer to someone", "Mark as filled"
// and "Not urgent". A place that leaves (marked not urgent) lets the next slide in, and the answer
// shows as a confirmation at the foot of the screen for 3 seconds. Without JavaScript the first
// place shows, and the full list is on Events & sessions (`?view=urgent`).
export function FocusCard({ items }: { items: FocusItem[] }) {
  const [index, setIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const total = items.length;
  const at = Math.min(index, Math.max(0, total - 1));
  const item = items[at];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!item) return null;
  const step = (by: number) => setIndex((at + by + total) % total);
  return (
    <>
      <article
        key={item.shiftId}
        aria-labelledby="focus-heading"
        data-focus=""
        className="animate-enter overflow-hidden rounded-xl border border-line bg-card"
      >
        <div className="flex min-h-11 items-center gap-2.5 bg-urgent-fill pr-2 pl-4 text-on-urgent">
          <Icon name="urgent" size={18} />
          <h3 id="focus-heading" className="font-semibold">
            Urgent place to fill
          </h3>
          <span className="tabular-nums opacity-90">
            {at + 1} of {total}
          </span>
          {total > 1 && (
            <span className="ml-auto flex gap-0.5">
              <button
                type="button"
                aria-label="Previous urgent place"
                onClick={() => step(-1)}
                className="flex size-9 items-center justify-center rounded-md hover:bg-on-urgent/15"
              >
                <Icon name="chevron" size={18} className="rotate-180" />
              </button>
              <button
                type="button"
                aria-label="Next urgent place"
                onClick={() => step(1)}
                className="flex size-9 items-center justify-center rounded-md hover:bg-on-urgent/15"
              >
                <Icon name="chevron" size={18} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 px-5 py-5">
          <DateTile
            dow={item.dow}
            day={item.day}
            month={item.month}
            size="lg"
            urgent
            label={item.dateLong}
          />
          <div className="min-w-0">
            <p className="font-sign text-4xl text-ink">{item.range}</p>
            <p className="mt-1 text-lg font-semibold">
              <Link
                href={`/office/shifts/${item.shiftId}`}
                className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                {item.role}
              </Link>
            </p>
            <p className="text-ink-muted">{item.where}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line bg-canvas px-5 py-3.5">
          <p className="flex items-center gap-3">
            <Seats
              taken={item.headcount - item.placesLeft}
              total={item.headcount}
              urgent
              size="lg"
            />
            <span>
              <strong className="font-semibold tabular-nums">
                {placesFreeText(item.placesLeft, item.headcount)}
              </strong>
            </span>
          </p>
          <p className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex size-5.5 items-center justify-center rounded ${
                item.notOffered ? "bg-hivis text-on-hivis" : "bg-raised text-ink-muted"
              }`}
            >
              <Icon name="requests" size={14} />
            </span>
            {item.notOffered ? "Not offered to anyone yet" : item.offered}
          </p>
          {item.escalated && (
            <p className="text-sm text-ink-muted">The office was emailed about it.</p>
          )}
        </div>
        {item.hidden && (
          <p className="mx-5 mt-3 rounded-md bg-urgent-soft px-3 py-2 font-semibold text-urgent">
            {item.hidden}
          </p>
        )}
        {(item.fromSheet || item.fromPlanner) && (
          <p className="px-5 pt-3 text-sm text-ink-muted">
            {item.fromSheet ? "From your Google Sheet" : "From your planner"}: change its places
            there.
          </p>
        )}
        <ShiftActions
          shiftId={item.shiftId}
          isUrgent
          fromSheet={item.fromSheet}
          fromPlanner={item.fromPlanner}
          className="px-5 pt-4 pb-5"
          onMessage={setToast}
        />
      </article>
      {toast && (
        <p
          role="status"
          className="fixed bottom-6 left-1/2 z-30 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 animate-toast items-center gap-2.5 rounded-lg bg-ink px-4 py-3 font-medium text-on-ink"
        >
          <Icon name="check" size={18} />
          {toast}
        </p>
      )}
    </>
  );
}
