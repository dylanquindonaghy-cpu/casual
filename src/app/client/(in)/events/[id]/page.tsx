import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, h2, headingGap, meta, nums, page, rows, table, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireClient } from "@/lib/client/current-client";
import { bookedOf, dayText, eventWhenLine, timesText, waitingFor } from "@/lib/client/page-copy";
import { clientEvent, clientRequestList } from "@/lib/client/reads";
import { roleLabel } from "@/lib/portal/format";
import { CoverBar, CoverChip, RequestLine } from "../../../client-parts";

export const metadata: Metadata = { title: "An event" };

// An event of theirs (Phase 36.3; the mock-up's "An event, laptop: numbers only"): its sessions to
// come, each its location (post), role, times, booked of places and chip; "Ask for a change" and
// "Add places"; then that event's requests still waiting. On a phone the sessions are a list of
// their own (no table to scroll). Another contract's or firm's event reads as not found.
export default async function ClientEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireClient();
  const ctx = { firm: s.firm, clientContactId: s.contact.id };
  const [event, requests] = await Promise.all([clientEvent(ctx, id), clientRequestList(ctx)]);
  if (!event || !requests) notFound();
  const tz = s.firm.timezone;
  const now = new Date();
  const days = new Set(event.sessions.map((x) => dayText(x.startsAt, tz)));
  const when = (x: { startsAt: Date; endsAt: Date }) =>
    days.size > 1
      ? `${dayText(x.startsAt, tz)} ${timesText(x.startsAt, x.endsAt, tz)}`
      : timesText(x.startsAt, x.endsAt, tz);
  const waiting = requests.filter(
    (r) => r.eventId === event.eventId && (r.status === "waiting" || r.status === "asked"),
  );
  const ask = (q: string) => `/client/requests/new?event=${event.eventId}${q}`;
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/client", label: "Your events" }}
        title={event.name}
        actions={
          <>
            <Link href={ask("")} className={btn.secondary}>
              Ask for a change
            </Link>
            <Link href={ask("&kind=more_places")} className={btn.primary}>
              Add places
            </Link>
          </>
        }
      >
        <p className={`text-ink-muted ${nums}`}>
          {eventWhenLine(event, tz)}
          {event.address ? ` · ${event.address}` : ""}
        </p>
        <p className="mt-2 flex max-w-md items-center gap-3">
          <CoverBar booked={event.booked} places={event.places} />
          <b className={`text-sm font-semibold ${nums}`}>{bookedOf(event.booked, event.places)}</b>
        </p>
      </PageHeader>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className={h2}>
          Sessions
        </h2>
        {/* A phone: a list. */}
        <ul role="list" className={`${rows} ${headingGap} md:hidden`}>
          {event.sessions.map((x) => (
            <li key={x.shiftId} className="flex flex-col gap-1 px-4 py-3">
              <p className="flex items-start gap-2">
                <b className="min-w-0 flex-1 break-words">
                  {[x.post, roleLabel(x.role)].filter(Boolean).join(" · ")}
                </b>
                <CoverChip {...x} />
              </p>
              <p className={`${meta} ${nums}`}>
                {when(x)} · {x.cancelled ? "Cancelled" : bookedOf(x.booked, x.places)}
              </p>
              {!x.cancelled && x.startsAt > now && (
                <Link href={ask(`&session=${x.shiftId}`)} className={`${textLink} self-start py-2`}>
                  Ask for a change to this session
                </Link>
              )}
            </li>
          ))}
        </ul>
        {/* From 768px: the table. */}
        <div
          role="region"
          tabIndex={0}
          aria-label="Sessions"
          className={`${table.wrap} ${headingGap} hidden md:block`}
        >
          <table className={table.table}>
            <thead>
              <tr>
                <th className={table.th}>Location</th>
                <th className={table.th}>Role</th>
                <th className={table.th}>Times</th>
                <th className={`${table.th} ${table.num}`}>Booked</th>
                <th className={table.th}>
                  <span className="sr-only">Cover</span>
                </th>
                <th className={table.th}>
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {event.sessions.map((x, i) => (
                <tr key={x.shiftId}>
                  <td className={`${table.td} font-semibold`}>
                    {x.post && x.post !== event.sessions[i - 1]?.post ? x.post : x.post ? "" : "—"}
                  </td>
                  <td className={table.td}>{roleLabel(x.role)}</td>
                  <td className={`${table.td} ${nums}`}>{when(x)}</td>
                  <td className={`${table.td} ${table.num}`}>
                    {x.booked}/{x.places}
                  </td>
                  <td className={table.td}>
                    <CoverChip {...x} />
                  </td>
                  <td className={table.td}>
                    {!x.cancelled && x.startsAt > now && (
                      <Link
                        href={ask(`&session=${x.shiftId}`)}
                        aria-label={`Ask for a change: ${[x.post, roleLabel(x.role), when(x)].filter(Boolean).join(", ")}`}
                        className={btn.small}
                      >
                        Change
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {waiting.length > 0 && (
        <section aria-labelledby="waiting-heading" className="mt-8">
          <h2 id="waiting-heading" className={h2}>
            {waitingFor(s.firm.name)}
          </h2>
          <ul role="list" className={`${rows} ${headingGap}`}>
            {waiting.map((r) => (
              <RequestLine key={r.id} r={r} firmName={s.firm.name} now={now} timeZone={tz} />
            ))}
          </ul>
          <p className={`${meta} mt-2`}>
            Questions from {s.firm.name} are answered on{" "}
            <Link href="/client/requests" className={textLink}>
              Your requests
            </Link>
            .
          </p>
        </section>
      )}
    </main>
  );
}
