import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, page, textLink } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { systemClock } from "@/lib/auth/clock";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { EVENT_LIST_MAX, EVENT_VIEWS, officeEventList, type EventView } from "@/lib/office/events";
import {
  boardDays,
  boardWindow,
  eventCells,
  eventNote,
  windowText,
} from "@/lib/office/events-board";
import { EVENT_VIEW_EMPTY, EVENT_VIEW_WORDS, eventSwitchLabel } from "@/lib/office/events-copy";
import { localDateOf } from "@/lib/time/zoned";
import { BoardDays, BoardKey } from "./board-parts";
import { EventRow } from "./event-row";
import { SessionsTable } from "./sessions-table";
import { ShowingSwitch } from "./showing-switch";

export const metadata: Metadata = { title: "Events & sessions" };

const isView = (v: unknown): v is EventView =>
  typeof v === "string" && (EVENT_VIEWS as readonly string[]).includes(v);

// The filters shown (Phase 18): "Showing" stays a view (the dashboard links to it), shown as a
// filter only while it's the one chosen.
const FILTERS: EventView[] = ["all", "need", "urgent", "hidden"];

const viewHref = (view: EventView, from?: string) => {
  const q = new URLSearchParams();
  if (view !== "all") q.set("view", view);
  if (from) q.set("from", from);
  const s = q.toString();
  return s ? `/office/events?${s}` : "/office/events";
};

// Events & sessions (docs/office-v2.md 3.3; docs/screens.md `/office/events`; Phases 18 and 20): a
// rota board of two weeks from today (or a later `from`), an event per row, soonest first, each
// session a pill on its day ("3/4": places filled out of needed; solid red only for an urgent gap,
// outlined while places are open, grey when full), today marked in the firm's colour and weekends
// a shade darker. The filters with their counts (All, Need people, Urgent, Hidden) and the dates
// (Earlier, Later) on one row, the key under them in plain words. An event's name or a pill opens
// its row into its sessions to come, with its "show to casuals" switch (not on the row: Phase 20),
// "Add a session" and its own page: role, when, places as seats, pay, the urgent switch and the
// "…" menu (offer, assign, change or cancel), then post, meeting point and uniform. Firms without
// a planner (no Google Sheet) add and import shifts from here; with one, a note says the sessions
// come from it. Admins and resourcers.
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; from?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { view: viewParam, from: fromParam } = await searchParams;
  const view: EventView = isView(viewParam) ? viewParam : "all";
  const list = await officeEventList({ firm }, (await readSessionToken("office")) ?? "", view);
  if (!list) notFound();
  const tz = list.timeZone;
  const today = localDateOf(systemClock.now(), tz);
  // From today, or a later day chosen with Later (anything else, or earlier, is today).
  const { from, earlier, later } = boardWindow(fromParam, today);
  const days = boardDays(from, today);
  const weekend = days.map((d) => d.weekend);
  const window = { first: days[0]?.date ?? from, last: days.at(-1)?.date ?? from };
  // Over every event to come, not just the ones listed (the list stops at 50).
  const { places: openPlaces, sessions: openSessions } = list.open;
  const filters = view === "showing" ? [...FILTERS, "showing" as const] : FILTERS;
  return (
    <main className={`${page.office} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-64 flex-1">
          <h1 className="text-title text-ink">Events &amp; sessions</h1>
          <p className="mt-2 text-ink-muted">
            <span className="tabular-nums">{openPlaces}</span>{" "}
            {openPlaces === 1 ? "open place" : "open places"} across{" "}
            <span className="tabular-nums">{openSessions}</span>{" "}
            {openSessions === 1 ? "session" : "sessions"}.{" "}
            <span className="tabular-nums">{list.counts.showing}</span> of{" "}
            <span className="tabular-nums">{list.counts.all}</span> events are showing to casuals.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {list.hasPlanner
              ? "Events and sessions come from your Google Sheet. Here you only choose what casuals see and what's urgent."
              : "Switch an event off to hide all its sessions from casuals."}{" "}
            <Link href="/office/shifts" className={textLink}>
              All shifts by day
            </Link>
          </p>
        </div>
        {!list.hasPlanner && (
          <div className="flex gap-2">
            <Link href="/office/shifts/import" className={btn.secondary}>
              <Icon name="import" size={17} />
              Import shifts
            </Link>
            <Link href="/office/shifts/event" className={btn.primary}>
              <Icon name="plus" size={17} />
              Add shifts
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {/* One row: on a phone it scrolls sideways inside its track, never the page. */}
        <nav
          aria-label="Show"
          className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-raised p-1 inset-shadow-sunk"
        >
          {filters.map((v) => (
            <Link
              key={v}
              href={viewHref(v, from === today ? undefined : from)}
              aria-current={v === view ? "page" : undefined}
              className={`press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 whitespace-nowrap ${
                v === view
                  ? "bg-card font-semibold text-ink shadow-soft"
                  : "font-medium text-ink-muted hover:bg-card/60 hover:text-ink active:bg-card"
              }`}
            >
              {EVENT_VIEW_WORDS[v]}
              <span className="font-semibold tabular-nums">{list.counts[v]}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Dates" className="flex items-center gap-1">
          {earlier !== null ? (
            <Link
              href={viewHref(view, earlier === "today" ? undefined : earlier)}
              aria-label="Earlier"
              className="press flex size-11 items-center justify-center rounded-full bg-button text-ink shadow-raise hover:bg-button-hover active:bg-button-press"
            >
              <Icon name="chevron" size={17} className="rotate-180" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full bg-raised text-line-strong"
            >
              <Icon name="chevron" size={17} className="rotate-180" />
            </span>
          )}
          <span className="px-2 font-semibold tabular-nums">{windowText(days)}</span>
          <Link
            href={viewHref(view, later)}
            aria-label="Later"
            className="press flex size-11 items-center justify-center rounded-full bg-button text-ink shadow-raise hover:bg-button-hover active:bg-button-press"
          >
            <Icon name="chevron" size={17} />
          </Link>
        </nav>
      </div>
      <BoardKey />

      <div
        role="region"
        aria-label="Rota board"
        tabIndex={0}
        className="overflow-x-auto rounded-card bg-card shadow-soft"
      >
        <div className="min-w-[58rem]">
          <BoardDays days={days} />
          {list.events.length === 0 ? (
            <p className="p-8 text-center text-ink-muted">
              {EVENT_VIEW_EMPTY[view]}{" "}
              {view !== "all" && (
                <Link href="/office/events" className={textLink}>
                  Show all events
                </Link>
              )}
            </p>
          ) : (
            list.events.map((e, i) => {
              const note = eventNote(e);
              return (
                <EventRow
                  key={e.eventId}
                  eventId={e.eventId}
                  name={e.name}
                  note={note.text}
                  urgent={note.urgent}
                  hidden={!e.showing}
                  first={i === 0}
                  weekend={weekend}
                  cells={eventCells(e, days, tz)}
                  panel={
                    <SessionsTable
                      event={e}
                      timeZone={tz}
                      hasPlanner={list.hasPlanner}
                      window={window}
                      showingSwitch={
                        <ShowingSwitch
                          target="event"
                          id={e.eventId}
                          showing={e.showing}
                          label={eventSwitchLabel(e)}
                          small
                        />
                      }
                    />
                  }
                />
              );
            })
          )}
        </div>
      </div>
      {list.more && (
        <p className="text-ink-muted">
          Showing the first {EVENT_LIST_MAX} events. Choose a filter to see fewer.
        </p>
      )}
    </main>
  );
}
