import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, headingGap, page, tab, tabCount, tabCurrent, tabs } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import {
  ADD_SHIFTS,
  BREADCRUMB,
  cancellationLine,
  cancellationWhen,
  EVENT_TAB_WORDS,
  EVENT_TABS,
  eventLine,
  eventTabHref,
  historyWhen,
  NO_CANCELLATIONS,
  NO_HISTORY,
  SEE_IN_LOG,
  SHOWING_CHIP,
  strikeWords,
  type EventTab,
} from "@/lib/office/event-page-copy";
import { officeEventPage } from "@/lib/office/events";
import { eventStatus, eventSummary, spansDays, uniqueSessionNames } from "@/lib/office/events-copy";
import { SessionItem } from "../session-row";
import { OfferOpenPlaces, ShowHideButton } from "./event-actions";
import { StaffingTab } from "./staffing";

// One event (docs/screens.md "An event's page, round 8"; Phase 26.5, the spec page's evt-1 to
// evt-6): a breadcrumb; its name with whether casuals see it, its day, venue and sessions; "Hide from
// casuals" (or "Show to casuals"), "Add shifts" (to this event) and the main "Offer N open places";
// then tabs: Staffing (the default: every place laid out, beside the open places), Overview (every
// session as before, past and cancelled too, each with its switch, who is booked and its menu),
// Cancellations and History. Admins and resourcers. Like a shift's page, it keeps the firm's tab
// title.
export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; place?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { id } = await params;
  const { tab: tabParam, place } = await searchParams;
  const data = await officeEventPage({ firm }, (await readSessionToken("office")) ?? "", id);
  if (!data) notFound();
  const { event: e, timeZone: tz, staffing: st } = data;
  const now = new Date();
  const current: EventTab = (EVENT_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as EventTab)
    : "staffing";
  const openPlaces = st.open.reduce((n, o) => n + o.placesFree, 0);
  const counts: Partial<Record<EventTab, number>> = {
    staffing: st.needed,
    overview: e.sessionCount,
    cancellations: st.cancellations.length,
  };
  return (
    <main className={`${page.office} @container`}>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-muted">
        <ol role="list" className="flex flex-wrap items-center gap-1">
          <li className="flex items-center gap-1">
            <Icon name="home" size={14} />
            <Link href="/office" className="hover:text-ink hover:underline">
              {BREADCRUMB[0]}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href="/office/events" className="hover:text-ink hover:underline">
              {BREADCRUMB[1]}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <span aria-current="page" className="font-medium text-ink">
              {e.name}
            </span>
          </li>
        </ol>
      </nav>
      <PageHeader
        title={e.name}
        actions={
          <>
            <ShowHideButton eventId={e.eventId} showing={e.showing} />
            <Link href={`/office/shifts/event?event=${e.eventId}`} className={btn.secondary}>
              <Icon name="plus" size={16} />
              {ADD_SHIFTS}
            </Link>
            <OfferOpenPlaces eventId={e.eventId} places={openPlaces} />
          </>
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted tabular-nums">
          <StatusChip tone={e.showing ? "done" : "quiet"}>
            {e.showing ? SHOWING_CHIP.on : SHOWING_CHIP.off}
          </StatusChip>
          <span>{eventLine(e.firstStartsAt, e.lastStartsAt, st.venue, e.sessionCount, tz)}</span>
        </p>
      </PageHeader>

      <nav aria-label="Show" className={`${tabs} mb-4`}>
        {EVENT_TABS.map((t) => (
          <Link
            key={t}
            href={eventTabHref(e.eventId, t)}
            aria-current={t === current ? "page" : undefined}
            className={t === current ? tabCurrent : tab}
          >
            {EVENT_TAB_WORDS[t]}
            {counts[t] !== undefined && (
              <span className={tabCount(t === current)}>{counts[t]}</span>
            )}
          </Link>
        ))}
      </nav>

      {current === "staffing" && (
        <StaffingTab
          staffing={st}
          eventId={e.eventId}
          chosenPlace={place ?? null}
          now={now}
          tz={tz}
        />
      )}

      {current === "overview" && <OverviewTab data={data} />}

      {current === "cancellations" && (
        <section aria-labelledby="event-cancellations" className="glass rounded-inner p-4">
          <h2 id="event-cancellations" className="px-1 text-lg font-semibold text-ink">
            {EVENT_TAB_WORDS.cancellations}
          </h2>
          {st.cancellations.length === 0 ? (
            <p className={`${headingGap} rounded-row glass-tile p-4 text-sm text-ink-muted`}>
              {NO_CANCELLATIONS}
            </p>
          ) : (
            <ul role="list" className={`${headingGap} flex flex-col divide-y divide-line`}>
              {st.cancellations.map((c) => (
                <li
                  key={c.assignmentId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
                >
                  <Link
                    href={`/office/cancellations/${c.assignmentId}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {cancellationLine(c)}
                  </Link>
                  {strikeWords(c.strike) && (
                    <StatusChip tone={c.strike === "live" ? "urgent" : "quiet"}>
                      {strikeWords(c.strike)}
                    </StatusChip>
                  )}
                  <span className="basis-full text-sm text-ink-muted tabular-nums">
                    {cancellationWhen(c.startsAt, c.role, c.at, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {current === "history" && (
        <section aria-labelledby="event-history" className="glass rounded-inner p-4">
          <h2 id="event-history" className="px-1 text-lg font-semibold text-ink">
            {EVENT_TAB_WORDS.history}
          </h2>
          {st.history.length === 0 ? (
            <p className={`${headingGap} rounded-row glass-tile p-4 text-sm text-ink-muted`}>
              {NO_HISTORY}
            </p>
          ) : (
            <ul role="list" className={`${headingGap} flex flex-col divide-y divide-line`}>
              {st.history.map((h, i) => (
                <li key={i} className="py-2 text-sm text-ink">
                  <span className="text-ink-muted tabular-nums">{historyWhen(h.at, tz)}:</span>{" "}
                  {h.words}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 px-1">
            <Link href="/office/log" className={btn.link}>
              {SEE_IN_LOG}
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}

// Every session as before round 8 (past and cancelled too): each with its own switch, who is
// booked, its menu, and once it has started "Mark who worked".
function OverviewTab({ data }: { data: NonNullable<Awaited<ReturnType<typeof officeEventPage>>> }) {
  const { event: e, timeZone } = data;
  const status = eventStatus(e);
  const withDay = spansDays(e, timeZone);
  const names = uniqueSessionNames(e.sessions, timeZone, withDay);
  return (
    <section aria-labelledby="sessions" className="flex flex-col gap-3">
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        <StatusChip tone={status.tone}>{status.words}</StatusChip>
        {e.urgentGap && <StatusChip tone="urgent">Urgent, not filled</StatusChip>}
        <span className="text-sm text-ink-muted tabular-nums">{eventSummary(e)}</span>
      </div>
      <h2 id="sessions" className="sr-only">
        Sessions
      </h2>
      {e.sessions.length === 0 ? (
        <p className={`${card} text-ink-muted`}>No sessions.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {e.sessions.map((s) => (
            <SessionItem
              key={s.shiftId}
              session={s}
              timeZone={timeZone}
              withDay={withDay}
              eventShowing={e.showing}
              full
              uniqueName={names.get(s.shiftId)}
              booked={data.booked[s.shiftId] ?? []}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
