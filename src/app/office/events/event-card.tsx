import Link from "next/link";
import { btn, card, textLink } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { StatusChip } from "@/app/ui/status-chip";
import type { EventCardData } from "@/lib/office/events";
import {
  eventStatus,
  eventSummary,
  eventSwitchLabel,
  eventWhereWhen,
  isFull,
  spansDays,
  uniqueSessionNames,
} from "@/lib/office/events-copy";
import { SessionItem } from "./session-row";
import { ShowingSwitch } from "./showing-switch";

// An event's card on Events & sessions (docs/office-v2.md 3.3, "Event card"): its name (a link to
// its page), place and date; the event's switch ("Show {event} to casuals"); one status tag
// (Showing or Hidden), plus "Urgent, not filled" only when it applies; "2 sessions · 3 places
// free"; then its sessions to come that still have places free, each with its "…" menu, the full
// ones folded under "{n} filled sessions" (Phase 17: what needs filling first), and "View sessions".
export function EventCard({ event: e, timeZone }: { event: EventCardData; timeZone: string }) {
  const status = eventStatus(e);
  const withDay = spansDays(e, timeZone);
  const names = uniqueSessionNames(e.sessions, timeZone, withDay);
  const href = `/office/events/${e.eventId}`;
  // An automatic event's name is its place and day already ("Acme Demo Arena · Sat 10 Oct").
  const whereWhen = eventWhereWhen(e, timeZone);
  // Full as the summary counts it: every place booked, or marked filled by the office.
  const open = e.sessions.filter((s) => !isFull(s));
  const full = e.sessions.filter(isFull);
  const item = (s: EventCardData["sessions"][number]) => (
    <SessionItem
      key={s.shiftId}
      session={s}
      timeZone={timeZone}
      withDay={withDay}
      eventShowing={e.showing}
      uniqueName={names.get(s.shiftId)}
    />
  );
  return (
    <article aria-labelledby={`event-${e.eventId}`} className={`${card} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`event-${e.eventId}`} className="text-lg font-bold tracking-tight text-ink">
            <Link href={href} className={textLink}>
              {e.name}
            </Link>
          </h2>
          {whereWhen !== e.name && <p className="text-sm text-ink-muted">{whereWhen}</p>}
        </div>
        <ShowingSwitch
          target="event"
          id={e.eventId}
          showing={e.showing}
          label={eventSwitchLabel(e)}
        />
      </div>
      <p className="flex flex-wrap items-center gap-2">
        <StatusChip tone={status.tone}>{status.words}</StatusChip>
        {e.urgentGap && <StatusChip tone="urgent">Urgent, not filled</StatusChip>}
        <span className="text-sm text-ink-muted tabular-nums">{eventSummary(e)}</span>
      </p>
      {open.length > 0 && (
        <ul role="list" className="flex flex-col gap-2">
          {open.map(item)}
        </ul>
      )}
      {full.length > 0 && (
        <details data-filled-sessions="" className="group rounded-lg border border-line">
          <summary className="flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-ink">
            <Icon name="chevron" className="h-4 w-4 transition-transform group-open:rotate-90" />
            {full.length === 1 ? "1 filled session" : `${full.length} filled sessions`}
          </summary>
          <ul role="list" className="flex flex-col gap-2 p-2 pt-0">
            {full.map(item)}
          </ul>
        </details>
      )}
      {e.moreSessions > 0 && (
        <p className="text-sm text-ink-muted">
          + {e.moreSessions} more {e.moreSessions === 1 ? "session" : "sessions"}
        </p>
      )}
      <p>
        <Link href={href} className={btn.primary} aria-label={`View sessions: ${e.name}`}>
          View sessions
        </Link>
      </p>
    </article>
  );
}
