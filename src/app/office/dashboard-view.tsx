import Link from "next/link";
import { attentionCount, type Dashboard } from "@/lib/office/dashboard";
import { dashboardModel } from "@/lib/office/dashboard-charts";
import { COUNT_ERROR, SECTION_ERROR } from "@/lib/office/dashboard-copy";
import {
  focusItems,
  greeting,
  headline,
  moreLabels,
  oneCount,
  startLine,
} from "@/lib/office/dashboard-home";
import { payWeek } from "@/lib/pay/pay-week";
import { datePartsOfDay } from "@/lib/portal/sign-copy";
import { countUrgent, notice, quietLink } from "../ui/classes";
import { Icon } from "../ui/icons";
import { PanelHost } from "./dashboard/chart-panel";
import { CountCards, DashboardCharts } from "./dashboard/charts";
import { UrgentPlaces } from "./urgent-places";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; Phases 18, 20 to
// 23), one question: "what needs me now, and where do I start?". Phase 23 (round 3, the approved
// mock-up, docs/mockups/phase-23/): flat and white, every card with its hairline. Today and the
// week (the pay date is in the top bar); the greeting and the one count of what needs you (the
// urgent places still to fill and Needs attention's items: the menu's count, so they add up) in
// the page's one top heading, where to start and the firm's shifts line. Four count cards (urgent places,
// needs attention, waiting on others, sorted today), each a link to its list that, once the page
// is ready, opens the list in a panel instead; every urgent place as a card with a wide "Offer"
// and "…" (mark as filled, not urgent); then six charts that show what needs work (places to fill
// over the next 2 weeks, which events need people, this week's offers, how long things have
// waited, the last 2 weeks' cancellations, licences running out), each mark opening its real rows
// with what to do about them. Every part says when it couldn't load and what it shows when empty;
// the page's loading skeleton is DashboardSkeleton (./office-skeleton.tsx). Pure: the page loads
// the data; src/lib/office/dashboard-home.ts and dashboard-charts.ts work out what it says.

// A section's heading row: its icon in a tinted chip, its name, its count (red for the urgent
// places), and a quiet link to the whole list at the end. The heading's id is where a link lands
// (clear of the sticky top bar: the office's scroll padding, globals.css), and focus with it when
// the link was in the panel.
function SectionHead({ count }: { count?: string }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-y-2">
      <span
        aria-hidden="true"
        className="mr-3 flex size-10 shrink-0 items-center justify-center rounded-row bg-urgent-tile text-urgent-ink"
      >
        <Icon name="urgent" size={20} />
      </span>
      <h2 id="urgent-places" tabIndex={-1} className="text-lg font-bold tracking-heading text-ink">
        Urgent places to fill
      </h2>
      {count && <span className={countUrgent}>{count}</span>}
      <span className="ml-auto pl-4">
        <Link href="/office/events?view=urgent" className={quietLink}>
          All on Events &amp; sessions
          <Icon name="chevron" size={16} />
        </Link>
      </span>
    </div>
  );
}

// What a section says when it couldn't load: in the section, with the rest of the page still there.
function SectionError() {
  return (
    <p role="status" className={`${notice} flex items-start gap-2`}>
      <Icon name="info" size={18} className="mt-1" />
      {SECTION_ERROR}
    </p>
  );
}

export function DashboardContent({
  d,
  firmName,
  shiftsLine,
  payQueriesWaiting = 0,
  pay = false,
  now,
}: {
  d: Dashboard;
  firmName: string;
  shiftsLine?: string;
  // null: it couldn't be read (its card and its panel say so).
  payQueriesWaiting?: number | null;
  // The office user's role can open Pay (admins): the waiting card goes to the pay queries.
  pay?: boolean;
  now: Date;
}) {
  const focus = focusItems(d);
  const needs = d.needs.ok ? d.needs.data : null;
  const needPerson = d.counts.enquiries.ok ? d.counts.enquiries.data.needPerson : 0;
  const attention = needs ? attentionCount(needs, needPerson) : null;
  const urgentPlaces = d.counts.urgent.ok ? d.counts.urgent.data.places : 0;
  const things = oneCount(urgentPlaces, attention?.count ?? needPerson);
  // What the headline counts could all be read (each part that couldn't says so where it shows);
  // a list stopped at 50 is counted as "at least".
  const complete =
    d.counts.urgent.ok && d.needs.ok && d.counts.enquiries.ok && !(attention?.more ?? false);
  const model = dashboardModel(d, { now, pay, payQueriesWaiting });
  return (
    <PanelHost>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink-muted tabular-nums">
            {datePartsOfDay(d.today).long} · Week {payWeek(d.today).week}
          </p>
          <h1 className="text-ink">
            <span className="block text-title">
              {greeting(now, d.timeZone)}, {firmName}.
            </span>{" "}
            <span className="mt-2 block text-lg font-bold">{headline(things, complete)}.</span>
          </h1>
          <p className="text-base text-ink-muted">
            {startLine(focus[0], things, complete, urgentPlaces)}
          </p>
          {shiftsLine && (
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <Icon name="phone" size={16} />
              {shiftsLine}
            </p>
          )}
        </header>

        <CountCards cards={model.cards} />

        <section
          aria-labelledby="urgent-places"
          className="flex min-w-0 flex-col gap-4 rounded-inner has-[:target]:animate-landed"
        >
          <SectionHead count={focus.length > 0 ? String(focus.length) : undefined} />
          {d.urgent.ok ? (
            <UrgentPlaces items={focus} labels={moreLabels(focus)} />
          ) : (
            <SectionError />
          )}
          {d.urgent.ok && d.urgent.data.more && (
            <p className="text-sm text-ink-muted">
              More urgent places are on Events &amp; sessions.
            </p>
          )}
        </section>

        <DashboardCharts
          charts={model.charts}
          words={{ section: SECTION_ERROR, count: COUNT_ERROR }}
        />
      </div>
    </PanelHost>
  );
}
