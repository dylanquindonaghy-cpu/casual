import Link from "next/link";
import { summaryButton } from "@/app/office/shifts/[id]/chevron";
import { Icon } from "@/app/ui/icons";
import { StatusChip } from "@/app/ui/status-chip";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import {
  cardSessionTime,
  eventCardTitle,
  eventStatus,
  eventSummary,
  eventSwitchLabel,
  filledPlaces,
  filledSessionsText,
  isFull,
  moreSessionsText,
  requirementChip,
  sessionWhere,
  spansDays,
  uniqueSessionNames,
} from "@/lib/office/events-copy";
import { SHIFT_STATUS_WORDS } from "@/lib/office/shifts-copy";
import { roleLabel } from "@/lib/portal/format";
import { pounds } from "@/lib/portal/pay-format";
import { SessionMenu } from "./session-menu";
import { ShowingSwitch } from "./showing-switch";

// An event on Events & sessions (Phase 24, 24.4: round 7 of the canvas; docs/screens.md
// `/office/events`), a glass card: its name and, under it, its place and dates; its "show to
// casuals" switch at the top right, described by its answer in words beside it ("Showing to
// casuals" or "Hidden from casuals"), "Urgent, not filled" with an urgent gap, and "4 sessions · 5
// places free". Then its sessions to come that still have places (or are urgent), each a tile, the
// filled ones folded under them ("1 filled session"), and "View sessions", its own page, where
// every session (past and cancelled too) is with who is booked. Pure: the page passes the loader's
// card (src/lib/office/events.ts).

// One session's tile: the role (→ the session's page) and when, Urgent on an urgent gap, a chip per
// requirement and where its casuals go (its post, else its meeting point); then how many places are filled (a meter under "3/4
// filled"), the pay an hour and its "…" menu (offer, assign, urgent, change or cancel). From a
// card 30rem wide the right half sits beside the left; narrower, under it.
function SessionTile({
  session: s,
  name,
  timeZone,
  withDay,
  eventShowing,
}: {
  session: SessionRow;
  name: string; // unique on the page: its menu's
  timeZone: string;
  withDay: boolean;
  eventShowing: boolean;
}) {
  const filled = filledPlaces(s);
  const where = sessionWhere(s);
  const share = s.headcount > 0 ? Math.round((filled / s.headcount) * 100) : 0;
  return (
    <li
      data-session={s.shiftId}
      className="glass-tile relative grid gap-x-3 gap-y-3 rounded-row px-4 py-3 @min-[30rem]:grid-cols-[minmax(0,1fr)_auto] @min-[30rem]:items-center"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link
            href={`/office/shifts/${s.shiftId}`}
            className="press font-semibold text-ink underline-offset-4 hover:underline"
          >
            {roleLabel(s.role)}
          </Link>
          <span className="text-ink-muted tabular-nums">
            {cardSessionTime(s, timeZone, withDay)}
          </span>
        </p>
        {(s.urgentGap || s.status === "draft") && (
          <p className="flex flex-wrap gap-2">
            {s.urgentGap && <StatusChip tone="urgent">Urgent</StatusChip>}
            {s.status === "draft" && (
              <StatusChip tone="quiet">{SHIFT_STATUS_WORDS[s.status]}</StatusChip>
            )}
          </p>
        )}
        {(s.requirements.length > 0 || where) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
            {s.requirements.map((r) => (
              <span
                key={r.code}
                className="inline-flex h-6 items-center rounded-full glass-button px-2 text-sm font-semibold text-ink"
              >
                {requirementChip(r)}
              </span>
            ))}
            {where && <span>{where}</span>}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="w-28">
          <p className="text-sm text-ink-muted tabular-nums">
            <span className="font-semibold text-ink">
              {filled}/{s.headcount}
            </span>{" "}
            filled
          </p>
          <span
            aria-hidden="true"
            className="mt-1 block h-1.5 overflow-hidden rounded-full bg-quiet-soft"
          >
            <span
              data-meter
              className="block h-full rounded-full bg-ink"
              style={{ width: `${share}%` }}
            />
          </span>
        </div>
        {s.payRatePence !== null && (
          <span className="whitespace-nowrap text-ink tabular-nums">
            {pounds(s.payRatePence)}/h
          </span>
        )}
        <span className="ml-auto">
          <SessionMenu session={s} name={name} eventShowing={eventShowing} />
        </span>
      </div>
    </li>
  );
}

export function EventCard({ event: e, timeZone }: { event: EventCardData; timeZone: string }) {
  const { title, line } = eventCardTitle(e, timeZone);
  const withDay = spansDays(e, timeZone);
  const names = uniqueSessionNames(e.sessions, timeZone, withDay);
  const status = eventStatus(e);
  const titleId = `event-${e.eventId}-title`;
  const statusId = `event-${e.eventId}-status`;
  // Those with places to fill first; the filled ones folded (an urgent gap always has a place).
  const toFill = e.sessions.filter((s) => !isFull(s));
  const filled = e.sessions.filter(isFull);
  const tile = (s: SessionRow) => (
    <SessionTile
      key={s.shiftId}
      session={s}
      name={names.get(s.shiftId) ?? roleLabel(s.role)}
      timeZone={timeZone}
      withDay={withDay}
      eventShowing={e.showing}
    />
  );
  return (
    <article
      aria-labelledby={titleId}
      data-event={e.eventId}
      className="glass @container flex flex-col gap-4 rounded-inner p-4 @min-[36rem]:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold break-words text-ink">
            {title}
          </h2>
          {line !== title && <p className="mt-1 text-sm text-ink-muted">{line}</p>}
        </div>
        <ShowingSwitch
          target="event"
          id={e.eventId}
          showing={e.showing}
          label={eventSwitchLabel(e)}
          describedBy={statusId}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={statusId}>
          <StatusChip tone={status.tone}>{status.words}</StatusChip>
        </span>
        {e.urgentGap && <StatusChip tone="urgent">Urgent, not filled</StatusChip>}
        <span className="ml-auto text-sm text-ink-muted tabular-nums">{eventSummary(e)}</span>
      </div>
      {toFill.length > 0 && (
        <ul role="list" className="flex flex-col gap-2">
          {toFill.map(tile)}
        </ul>
      )}
      {filled.length > 0 && (
        <details className="group/filled">
          <summary
            className={`${summaryButton} press flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-row px-4 text-ink-muted hover:bg-active hover:text-ink active:bg-button-press`}
          >
            {filledSessionsText(filled.length)}
            <Icon
              name="chevron"
              size={16}
              className="rotate-90 transition-transform duration-200 ease-sd group-open/filled:-rotate-90 motion-reduce:transition-none"
            />
          </summary>
          <ul role="list" className="mt-2 flex flex-col gap-2">
            {filled.map(tile)}
          </ul>
        </details>
      )}
      {e.moreSessions > 0 && (
        <p className="px-4 text-sm text-ink-muted">{moreSessionsText(e.moreSessions)}</p>
      )}
      <Link
        href={`/office/events/${e.eventId}`}
        aria-label={`View sessions: ${e.name}`}
        className="press inline-flex min-h-11 w-fit items-center gap-2 rounded-row font-medium text-ink underline-offset-4 hover:underline"
      >
        View sessions
        <Icon name="arrow" size={16} />
      </Link>
    </article>
  );
}
