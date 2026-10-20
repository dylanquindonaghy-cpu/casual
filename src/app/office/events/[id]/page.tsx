import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, headingGap, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeEventPage } from "@/lib/office/events";
import {
  eventStatus,
  eventSummary,
  eventSwitchLabel,
  eventWhereWhen,
  spansDays,
  uniqueSessionNames,
} from "@/lib/office/events-copy";
import { SessionItem } from "../session-row";
import { ShowingSwitch } from "../showing-switch";

// One event (docs/office-v2.md 3.3; docs/screens.md `/office/events/[id]`): its switch and status,
// then every session (past and cancelled too), each with its own uniquely labelled switch, who is
// booked and, once it has started, "Mark who worked". Admins and resourcers. Like a shift's page,
// it keeps the firm's tab title.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm } = await requireOfficeArea("shifts");
  const { id } = await params;
  const data = await officeEventPage({ firm }, (await readSessionToken("office")) ?? "", id);
  if (!data) notFound();
  const { event: e, timeZone } = data;
  const status = eventStatus(e);
  const withDay = spansDays(e, timeZone);
  const names = uniqueSessionNames(e.sessions, timeZone, withDay);
  return (
    <main className={page.office}>
      <PageHeader title={e.name}>
        {eventWhereWhen(e, timeZone) !== e.name && <p>{eventWhereWhen(e, timeZone)}</p>}
      </PageHeader>

      <div className={`${card} flex items-start justify-between gap-3`}>
        <p className="flex min-w-0 flex-wrap items-center gap-2 pt-2">
          <StatusChip tone={status.tone}>{status.words}</StatusChip>
          {e.urgentGap && <StatusChip tone="urgent">Urgent, not filled</StatusChip>}
          <span className="text-sm text-ink-muted tabular-nums">{eventSummary(e)}</span>
        </p>
        <ShowingSwitch
          target="event"
          id={e.eventId}
          showing={e.showing}
          label={eventSwitchLabel(e)}
        />
      </div>

      <section className={sectionGap.office} aria-labelledby="sessions">
        <h2 id="sessions" className={h2}>
          Sessions
        </h2>
        {e.sessions.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>No sessions.</p>
        ) : (
          <ul role="list" className={`${headingGap} flex flex-col gap-3`}>
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

      <p className={sectionGap.office}>
        <Link href="/office/events" className={btn.link}>
          Back to Events &amp; sessions
        </Link>
      </p>
    </main>
  );
}
