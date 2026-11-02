import Link from "next/link";
import type { ReactNode } from "react";
import { tab, tabCount, tabCurrent, tabs } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { StatusChip } from "@/app/ui/status-chip";
import { initialsOf } from "@/lib/office/event-page-copy";
import {
  CASUALS_TAB_WORDS,
  CASUALS_TITLE,
  COULD_MORE,
  distanceText,
  emptyTabText,
  FILTER_WORDS,
  clockTime,
  holdsLine,
  MOST_RELIABLE_FIRST,
  reliabilityText,
  whenText,
  type FilterKey,
} from "@/lib/office/session-page-copy";
import {
  CASUALS_TABS,
  type CasualsTab,
  type SessionCasual,
  type SessionCasuals,
} from "@/lib/office/session-casuals";
import { BookButton, RowMenu } from "./casual-actions";

// "Casuals for this session" (Phase 26.6, ses-2 and ses-3; docs/screens.md "A session, round 8"):
// tabs Asked for it, Offered, Said no, Booked and Could take it, each with its count; filters for
// reliability, distance and worked here before (links: they work before the page is ready); most
// reliable first. Each row: initials, the name, what they hold and how they've done here, their
// reliability with its band's bar, how far, and the row's chip ("Asked 14:02"); "Book" where the
// rules say yes and a place is free, and a "…" menu with "Not this time" for an ask still waiting.
// The Booked tab shows the session's own bookings (`booked`: cancel one, mark who worked).

const BAND_BAR = { green: "bg-done-fill", amber: "bg-attention", red: "bg-urgent-fill" };

export type CasualsQuery = {
  show: CasualsTab;
  filters: Record<FilterKey, boolean>;
};

export function casualsHref(shiftId: string, q: CasualsQuery, change: Partial<CasualsQuery>) {
  const next = { show: change.show ?? q.show, filters: { ...q.filters, ...change.filters } };
  const params = new URLSearchParams();
  if (next.show !== "asked") params.set("show", next.show);
  if (next.filters.reliable) params.set("rel", "80");
  if (next.filters.near) params.set("near", "45");
  if (next.filters.here) params.set("here", "1");
  const s = params.toString();
  return `/office/shifts/${shiftId}${s ? `?${s}` : ""}`;
}

function Reliability({ c }: { c: SessionCasual }) {
  const r = c.reliability;
  return (
    <span className="flex flex-col gap-1">
      <span className="font-semibold text-ink tabular-nums">{reliabilityText(c)}</span>
      {r.kind === "figure" && (
        <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
          <span
            className={`block h-full rounded-full ${BAND_BAR[r.band]}`}
            style={{ width: `${r.percent}%` }}
          />
        </span>
      )}
    </span>
  );
}

export function CasualsCard({
  shiftId,
  casuals,
  query,
  timeZone,
  canPlace,
  booked,
}: {
  shiftId: string;
  casuals: SessionCasuals;
  query: CasualsQuery;
  timeZone: string;
  canPlace: boolean;
  booked: ReactNode; // the Booked tab's own list (bookings: cancel, mark who worked)
}) {
  const current = query.show;
  const list = casuals.rows[current];
  const filtered = Object.values(query.filters).some(Boolean);
  const filterKeys = (Object.keys(FILTER_WORDS) as FilterKey[]).filter(
    (k) => k !== "near" || casuals.travelOn,
  );
  const time = (d: Date) => clockTime(d, timeZone);
  return (
    <section
      aria-labelledby="casuals-heading"
      className="@container glass min-w-0 rounded-inner p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="casuals-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Icon name="team" size={18} />
          {CASUALS_TITLE}
        </h2>
        <span className="text-sm text-ink-muted">{MOST_RELIABLE_FIRST}</span>
      </div>
      <nav aria-label="Casuals" className={`${tabs} mt-3`}>
        {CASUALS_TABS.map((t) => (
          <Link
            key={t}
            href={casualsHref(shiftId, query, { show: t })}
            aria-current={t === current ? "page" : undefined}
            className={t === current ? tabCurrent : tab}
          >
            {CASUALS_TAB_WORDS[t]}
            <span className={tabCount(t === current)}>{casuals.counts[t]}</span>
          </Link>
        ))}
      </nav>
      {current !== "booked" && (
        <ul role="list" aria-label="Filters" className="mt-3 flex flex-wrap gap-2">
          {filterKeys.map((k) => {
            const on = query.filters[k];
            return (
              <li key={k}>
                <Link
                  href={casualsHref(shiftId, query, { filters: { ...query.filters, [k]: !on } })}
                  aria-pressed={on}
                  role="button"
                  className={`press-glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium ${
                    on
                      ? "bg-ink text-on-ink"
                      : "glass-button text-ink hover:bg-button-hover active:bg-button-press"
                  }`}
                >
                  {on && <Icon name="check" size={14} />}
                  {FILTER_WORDS[k]}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {current === "booked" ? (
        <div className="mt-3">{booked}</div>
      ) : list.length === 0 ? (
        <p className="mt-3 rounded-row glass-tile p-4 text-sm text-ink-muted">
          {emptyTabText(current, casuals.casualsAsk, filtered)}
        </p>
      ) : (
        <ul role="list" className="mt-3 flex flex-col gap-2" data-casuals={current}>
          {list.map((c) => (
            <li key={c.workerId} className="rounded-row glass-tile p-3" data-casual={c.name}>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 @min-[40rem]:grid-cols-[auto_minmax(0,1fr)_8.5rem_6.5rem_8.5rem_7.5rem]">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-button-press text-sm font-semibold text-ink"
                >
                  {initialsOf(c.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{c.name}</span>
                  <span className="block text-sm text-ink-muted">{holdsLine(c)}</span>
                </span>
                <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 @min-[40rem]:contents">
                  <Reliability c={c} />
                  <span className="text-sm text-ink tabular-nums">{distanceText(c)}</span>
                  <span>
                    <StatusChip
                      tone={
                        c.notThisTime || current === "said_no" || current === "could"
                          ? "quiet"
                          : "wait"
                      }
                    >
                      {whenText(current, c, time)}
                    </StatusChip>
                  </span>
                  <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {canPlace && c.canBook && (
                      <BookButton shiftId={shiftId} workerId={c.workerId} name={c.name} />
                    )}
                    <RowMenu
                      shiftId={shiftId}
                      workerId={c.workerId}
                      name={c.name}
                      canDecline={canPlace && current === "asked" && !c.notThisTime}
                      profileHref={`/office/casuals/${c.workerId}`}
                    />
                  </span>
                </div>
              </div>
              {!c.canBook && c.reasons.length > 0 && (
                <p className="mt-2 text-sm text-ink-muted">
                  Can&apos;t be booked: {c.reasons.join(" ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {current === "could" && casuals.couldMore && (
        <p className="mt-2 px-1 text-sm text-ink-muted">{COULD_MORE}</p>
      )}
    </section>
  );
}
