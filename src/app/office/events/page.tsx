import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, page, tab, tabCount, tabCurrent, tabs, textLink } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { EVENT_LIST_MAX, EVENT_VIEWS, officeEventList, type EventView } from "@/lib/office/events";
import {
  EVENT_VIEW_EMPTY,
  EVENT_VIEW_WORDS,
  eventFilters,
  eventsLine,
} from "@/lib/office/events-copy";
import { EventCard } from "./event-card";

export const metadata: Metadata = { title: "Events & sessions" };

const isView = (v: unknown): v is EventView =>
  typeof v === "string" && (EVENT_VIEWS as readonly string[]).includes(v);

const viewHref = (view: EventView, site?: string) => {
  const q = new URLSearchParams();
  if (view !== "all") q.set("view", view);
  if (site) q.set("site", site);
  const s = q.toString();
  return s ? `/office/events?${s}` : "/office/events";
};

// Events & sessions (docs/office-v2.md 3.3; docs/screens.md `/office/events`; Phase 24, 24.4: round
// 7 of the canvas, approved by Dylan on 26 Oct 2026; docs/mockups/phase-24/): "Events & sessions",
// what it's for, and All shifts by day (the shifts list, a day at a time), Import shifts and Add
// shifts (firms without a Google Sheet: with one, the sessions come from it); the filters (All,
// Showing, Hidden, "Urgent, not filled", each with its count; "Need people", the top bar's To fill,
// while it's the one chosen) with how many events have sessions to come and their places free;
// then every event with a session to come, soonest first, as glass cards in two columns from a
// 56rem page (./event-card.tsx). Phase 18's two-week rota board gave way to them: a session's
// urgent switch is in its "…" menu, and the days are on the shifts list. Admins and resourcers.
// `site` (a site the top bar's search found, Phase 24) shows only the events there, their counts
// and places too, with a way back to every site.
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; site?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { view: viewParam, site: siteParam } = await searchParams;
  const view: EventView = isView(viewParam) ? viewParam : "all";
  const list = await officeEventList(
    { firm },
    (await readSessionToken("office")) ?? "",
    view,
    typeof siteParam === "string" ? siteParam : null,
  );
  if (!list) notFound();
  // Kept in every link that changes the filter.
  const site = list.site?.id;
  return (
    <main className={page.office}>
      <div className="@container flex flex-col gap-6">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-title text-ink">Events &amp; sessions</h1>
            <p className="mt-1 text-ink-muted">
              {list.hasPlanner
                ? "Events and sessions come from your Google Sheet. Here you only choose what casuals see and what's urgent."
                : "Choose what casuals see and what's urgent. Switch an event off to hide all its sessions from casuals."}
            </p>
            {list.site && (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 font-semibold text-ink">
                At {list.site.name}.
                <Link href={viewHref(view)} className={textLink}>
                  Show every site
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/office/shifts" className={btn.secondary}>
              All shifts by day
            </Link>
            {!list.hasPlanner && (
              <>
                <Link href="/office/shifts/import" className={btn.secondary}>
                  <Icon name="import" size={17} />
                  Import shifts
                </Link>
                <Link href="/office/shifts/event" className={btn.primary}>
                  <Icon name="plus" size={17} />
                  Add shifts
                </Link>
              </>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* One row: on a phone it scrolls sideways inside its track, never the page. */}
          <nav aria-label="Show" className={tabs}>
            {eventFilters(view).map((v) => (
              <Link
                key={v}
                href={viewHref(v, site)}
                aria-current={v === view ? "page" : undefined}
                className={v === view ? tabCurrent : tab}
              >
                {EVENT_VIEW_WORDS[v]} <span className={tabCount(v === view)}>{list.counts[v]}</span>
              </Link>
            ))}
          </nav>
          <p className="text-sm text-ink-muted tabular-nums">
            {eventsLine(list.counts.all, list.open.places)}
          </p>
        </div>

        {list.events.length === 0 ? (
          <p className="glass rounded-inner p-8 text-center text-ink-muted">
            {EVENT_VIEW_EMPTY[view]}{" "}
            {(view !== "all" || site) && (
              <Link href="/office/events" className={textLink}>
                Show all events
              </Link>
            )}
          </p>
        ) : (
          <div className="grid items-start gap-4 @min-[56rem]:grid-cols-2">
            {list.events.map((e) => (
              <EventCard key={e.eventId} event={e} timeZone={list.timeZone} />
            ))}
          </div>
        )}
        {list.more && (
          <p className="text-ink-muted">
            Showing the first {EVENT_LIST_MAX} events. Choose a filter to see fewer.
          </p>
        )}
      </div>
    </main>
  );
}
