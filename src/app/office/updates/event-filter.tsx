"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { updatesViewHref, type UpdateKind, type UpdatePeriod } from "@/lib/office/updates-view";
import { field } from "../../ui/classes";

// Updates' "Which event" (Phase 36.2): every event, or one with something in the period. Choosing
// one opens that view at once, keeping the period and the kind; the address holds the view, so a
// link to it opens the same. Waits for the page (docs/ui-design.md "Forms wait for the page").
export function EventFilter({
  label,
  allWords,
  chosen,
  events,
  period,
  kind,
}: {
  label: string;
  allWords: string;
  chosen: string | null;
  events: { id: string; name: string }[];
  period: UpdatePeriod;
  kind: UpdateKind;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        name="event"
        value={chosen ?? ""}
        disabled={!ready}
        onChange={(e) => {
          const value = e.currentTarget.value;
          router.push(updatesViewHref({ period, kind, eventId: value === "" ? null : value }));
        }}
        className={`${field} max-w-full min-w-0 rounded-full pr-8 disabled:opacity-60 sm:max-w-80`}
        data-event-filter=""
      >
        <option value="">{allWords}</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );
}
