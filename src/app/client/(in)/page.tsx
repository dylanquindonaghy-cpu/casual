import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  emptyBox,
  h2,
  headingGap,
  nums,
  page,
  quietLink,
  rows,
  tabCount,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireClient } from "@/lib/client/current-client";
import {
  bookedOf,
  EVENTS_TITLE,
  eventsIntro,
  eventWhenLine,
  NO_EVENTS,
  NO_REQUESTS,
  REQUESTS_TITLE,
} from "@/lib/client/page-copy";
import { clientEvents, clientRequestList } from "@/lib/client/reads";
import { CoverBar, CoverChip, RequestLine } from "../client-parts";

export const metadata: Metadata = { title: "Your events" };

// "Your events" (Phase 36.3; docs/screens.md "## Phase 36", "36.3 and 36.4 screens"): the contract's
// events to come, soonest first, each a card with its cover (booked of places, a bar and a chip:
// numbers only), "New request" and "Your requests", then their newest requests. The contract comes
// from the contact's own row (clientEvents), never from the address.
const SHOWN_REQUESTS = 3;

export default async function ClientEventsPage() {
  const s = await requireClient();
  const ctx = { firm: s.firm, clientContactId: s.contact.id };
  const [events, requests] = await Promise.all([clientEvents(ctx), clientRequestList(ctx)]);
  if (!events || !requests) notFound();
  const tz = s.firm.timezone;
  const now = new Date();
  const open = requests.filter((r) => r.status === "waiting" || r.status === "asked").length;
  return (
    <main className={page.office}>
      <PageHeader
        title={EVENTS_TITLE}
        actions={
          <>
            <Link href="/client/requests/new" className={btn.primary}>
              New request
            </Link>
            <Link href="/client/requests" className={btn.secondary}>
              Your requests
              {open > 0 && <span className={tabCount(false)}>{open}</span>}
            </Link>
          </>
        }
      >
        <p className="max-w-prose text-ink-muted">{eventsIntro(s.firm.name)}</p>
      </PageHeader>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading" className="sr-only">
          Events to come
        </h2>
        {events.length === 0 ? (
          <p className={emptyBox}>{NO_EVENTS}</p>
        ) : (
          <ul role="list" className="grid gap-3 lg:grid-cols-2">
            {events.map((e) => {
              const chip = {
                toFill: e.toFill,
                offering: e.sessions.some((x) => x.offering),
                cancelled: e.sessions.every((x) => x.cancelled),
              };
              return (
                <li
                  key={e.eventId}
                  className="glass relative flex flex-col gap-2 rounded-inner p-4 hover:bg-active"
                >
                  <p className="flex items-start gap-3">
                    <Link
                      href={`/client/events/${e.eventId}`}
                      className="press min-w-0 flex-1 text-lg font-semibold break-words text-ink before:absolute before:inset-0 before:rounded-inner"
                    >
                      {e.name}
                    </Link>
                    <CoverChip {...chip} />
                  </p>
                  <p className={`text-sm text-ink-muted ${nums}`}>{eventWhenLine(e, tz)}</p>
                  <p className="flex items-center gap-3">
                    <CoverBar booked={e.booked} places={e.places} />
                    <b className={`text-sm font-semibold ${nums}`}>
                      {bookedOf(e.booked, e.places)}
                    </b>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="requests-heading" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="requests-heading" className={h2}>
            {REQUESTS_TITLE}
          </h2>
          {requests.length > 0 && (
            <Link href="/client/requests" className={quietLink}>
              All your requests
            </Link>
          )}
        </div>
        {requests.length === 0 ? (
          <p className={`${emptyBox} ${headingGap}`}>{NO_REQUESTS}</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {requests.slice(0, SHOWN_REQUESTS).map((r) => (
              <RequestLine key={r.id} r={r} firmName={s.firm.name} now={now} timeZone={tz} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
