import Link from "next/link";
import { btn, card, textLink } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import type { EventCardData } from "@/lib/office/events";
import {
  eventStatus,
  eventSummary,
  eventSwitchLabel,
  eventWhereWhen,
  spansDays,
} from "@/lib/office/events-copy";
import { SessionItem } from "./session-row";
import { ShowingSwitch } from "./showing-switch";

// An event's card on Events & sessions (docs/office-v2.md 3.3, "Event card"): its name (a link to
// its page), place and date; the event's switch ("Show {event} to casuals"); one status tag
// (Showing or Hidden), plus "Urgent, not filled" only when it applies; "2 sessions · 3 places
// free"; then its sessions to come, each with its "…" menu, and "View sessions".
export function EventCard({ event: e, timeZone }: { event: EventCardData; timeZone: string }) {
  const status = eventStatus(e);
  const withDay = spansDays(e, timeZone);
  const href = `/office/events/${e.eventId}`;
  // An automatic event's name is its place and day already ("Acme Demo Arena · Sat 10 Oct").
  const whereWhen = eventWhereWhen(e, timeZone);
  return (
    <article
      aria-labelledby={`event-${e.eventId}`}
      className={`${card} flex flex-col gap-3 ${e.urgentGap ? "border-urgent" : ""}`}
    >
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
      <ul role="list" className="flex flex-col gap-2">
        {e.sessions.map((s) => (
          <SessionItem
            key={s.shiftId}
            session={s}
            timeZone={timeZone}
            withDay={withDay}
            eventShowing={e.showing}
          />
        ))}
      </ul>
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
