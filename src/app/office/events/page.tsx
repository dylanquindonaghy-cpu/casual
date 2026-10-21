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
  BOARD_DAYS,
  boardDays,
  eventCells,
  eventNote,
  windowText,
} from "@/lib/office/events-board";
import { EVENT_VIEW_EMPTY, EVENT_VIEW_WORDS, eventSwitchLabel } from "@/lib/office/events-copy";
import { addDays, localDateOf } from "@/lib/time/zoned";
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

// Events & sessions (docs/office-v2.md 3.3; docs/screens.md `/office/events`; Phase 18): a rota
// board of two weeks from today (or a later `from`), an event per row, soonest first, each session
// a pill on its day ("3/4": places filled out of needed; red for an urgent gap, outlined while
// places are open, grey when full). The filters with their counts (All, Need people, Urgent,
// Hidden), Earlier and Later. An event's name or a pill opens its row into its sessions to come:
// role, when, places as seats, pay, post, meeting point, uniform, the urgent switch and the "…"
// menu (offer, assign, change or cancel), with "Add a session" and its own page. Firms without a
// planner (no Google Sheet) add and import shifts from here; with one, a note says the sessions
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
  const from =
    typeof fromParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && fromParam > today
      ? fromParam
      : today;
  const days = boardDays(from, today);
  const weekend = days.map((d) => d.weekend);
  const window = { first: days[0]?.date ?? from, last: days.at(-1)?.date ?? from };
  const earlier =
    from > today
      ? addDays(from, -BOARD_DAYS) > today
        ? addDays(from, -BOARD_DAYS)
        : undefined
      : null;
  // Over every event to come, not just the ones listed (the list stops at 50).
  const { places: openPlaces, sessions: openSessions } = list.open;
  const filters = view === "showing" ? [...FILTERS, "showing" as const] : FILTERS;
  return (
    <main className={`${page.office} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-64 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">Events &amp; sessions</h1>
          <p className="mt-1 text-ink-muted">
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

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <nav aria-label="Show" className="flex flex-wrap gap-1">
          {filters.map((v) => (
            <Link
              key={v}
              href={viewHref(v, from === today ? undefined : from)}
              aria-current={v === view ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 ${
                v === view
                  ? "bg-ink font-semibold text-on-ink"
                  : "border border-line-strong text-ink-muted hover:bg-quiet-soft"
              }`}
            >
              {EVENT_VIEW_WORDS[v]}
              <span className="font-sign text-lg">{list.counts[v]}</span>
            </Link>
          ))}
        </nav>
        <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-4 w-6 rounded-[3px] bg-urgent-fill" />
            Urgent gap
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-4 w-6 rounded-[3px] border-[1.5px] border-ink" />
            Places open
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-4 w-6 rounded-[3px] bg-raised" />
            Full
          </span>
          <span>Pills show places filled out of places needed.</span>
        </p>
        <nav aria-label="Dates" className="ml-auto flex items-center gap-1">
          {earlier !== null ? (
            <Link
              href={viewHref(view, earlier)}
              aria-label="Earlier"
              className="flex size-9 items-center justify-center rounded-md border border-line hover:bg-quiet-soft"
            >
              <Icon name="chevron" size={17} className="rotate-180" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-md border border-line text-line-strong"
            >
              <Icon name="chevron" size={17} className="rotate-180" />
            </span>
          )}
          <span className="px-2 font-semibold tabular-nums">{windowText(days)}</span>
          <Link
            href={viewHref(view, addDays(from, BOARD_DAYS))}
            aria-label="Later"
            className="flex size-9 items-center justify-center rounded-md border border-line hover:bg-quiet-soft"
          >
            <Icon name="chevron" size={17} />
          </Link>
        </nav>
      </div>

      <div
        role="region"
        aria-label="Rota board"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-line"
      >
        <div className="min-w-[60rem]">
          <div className="grid grid-cols-[18rem_repeat(14,minmax(0,1fr))] border-b border-line bg-canvas">
            <div className="flex items-end px-3.5 py-2 text-sm font-semibold text-ink-muted">
              Event
            </div>
            {days.map((d) => (
              <div
                key={d.date}
                className={`border-l border-line py-1.5 text-center leading-tight ${d.weekend ? "bg-raised" : ""} ${
                  d.today ? "border-t-[3px] border-t-ink" : ""
                }`}
              >
                <div className="font-sign text-lg">{d.day}</div>
                <div className="text-sm text-ink-muted">{d.dow}</div>
              </div>
            ))}
          </div>
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
                  showingSwitch={
                    <ShowingSwitch
                      target="event"
                      id={e.eventId}
                      showing={e.showing}
                      label={eventSwitchLabel(e)}
                      small
                    />
                  }
                  panel={
                    <SessionsTable
                      event={e}
                      timeZone={tz}
                      hasPlanner={list.hasPlanner}
                      window={window}
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
