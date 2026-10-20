import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, page, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { EVENT_LIST_MAX, EVENT_VIEWS, officeEventList, type EventView } from "@/lib/office/events";
import { EVENT_VIEW_EMPTY, EVENT_VIEW_WORDS } from "@/lib/office/events-copy";
import { EventCard } from "./event-card";

export const metadata: Metadata = { title: "Events & sessions" };

const isView = (v: unknown): v is EventView =>
  typeof v === "string" && (EVENT_VIEWS as readonly string[]).includes(v);

// Events & sessions (docs/office-v2.md 3.3; docs/screens.md `/office/events`): every event with a
// session to come, soonest first, as a card. Tabs as links (back, refresh and sharing work): All ·
// Showing · Hidden · Urgent, not filled. Firms without a planner (no Google Sheet) add and import
// shifts from here; with one, a note says the sessions come from it. Admins and resourcers.
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { view: viewParam } = await searchParams;
  const view: EventView = isView(viewParam) ? viewParam : "all";
  const list = await officeEventList({ firm }, (await readSessionToken("office")) ?? "", view);
  if (!list) notFound();
  return (
    <main className={page.office}>
      <PageHeader
        title="Events & sessions"
        actions={
          list.hasPlanner ? undefined : (
            <>
              <Link href="/office/shifts/event" className={btn.primary}>
                Add shifts
              </Link>
              <Link href="/office/shifts/import" className={btn.secondary}>
                Import shifts
              </Link>
            </>
          )
        }
      >
        <p>
          {list.hasPlanner
            ? "Events and sessions come from your Google Sheet. Here you only choose what casuals see and what's urgent."
            : "Choose what casuals see and what's urgent. Switch an event off to hide all its sessions from casuals."}
        </p>
        <p>
          <Link href="/office/shifts" className={textLink}>
            All shifts by day
          </Link>
        </p>
      </PageHeader>

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {EVENT_VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "all" ? "/office/events" : `/office/events?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? `${btn.primary} rounded-full` : `${btn.secondary} rounded-full`}
          >
            {EVENT_VIEW_WORDS[v]}
          </Link>
        ))}
      </nav>

      {list.events.length === 0 ? (
        <p className={`${card} mt-6 text-ink-muted`}>{EVENT_VIEW_EMPTY[view]}</p>
      ) : (
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          {list.events.map((e) => (
            <EventCard key={e.eventId} event={e} timeZone={list.timeZone} />
          ))}
        </div>
      )}
      {list.more && (
        <p className="mt-4 text-ink-muted">
          Showing the first {EVENT_LIST_MAX} events. Choose a tab to see fewer.
        </p>
      )}
    </main>
  );
}
