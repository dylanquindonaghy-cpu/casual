import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { appEnv } from "@/lib/env";
import { updateWhen } from "@/lib/office/dashboard-map-copy";
import {
  isNew,
  officeUpdatesPage,
  UPDATES_PAGE_SHOWN,
  type PageUpdate,
  type UpdatesPage as UpdatesData,
} from "@/lib/office/updates";
import {
  ALL_EVENTS,
  coverPercent,
  EVENT_LABEL,
  KIND_TITLE,
  KIND_WORDS,
  LOW_COVER_ALL,
  LOW_COVER_LINE,
  LOW_COVER_NONE,
  LOW_COVER_TITLE,
  lowCoverLine,
  lowCoverWhen,
  MORE_IN_LOG,
  NEW_WORD,
  newTodayWords,
  nothingText,
  PERIOD_HEADINGS,
  PERIOD_TITLE,
  PERIOD_WORDS,
  showingNewest,
  UPDATES_TITLE,
  updateRow,
  updatesLine,
} from "@/lib/office/updates-copy";
import {
  groupByDay,
  parseUpdatesView,
  UPDATE_PERIODS,
  updatesViewHref,
  type UpdatesView,
} from "@/lib/office/updates-view";
import { btn, page, quietLink, tab, tabCount, tabCurrent, tabs } from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { StatusChip } from "../../ui/status-chip";
import { EventFilter } from "./event-filter";
import { MarkSeen } from "./mark-seen";
import { TellMePanel } from "./tell-me-panel";

export const metadata: Metadata = { title: "Updates" };

// Updates (Phase 26.4; docs/screens.md "Updates"; the mock-up's Updates): what happened on the
// person's contracts. Since Phase 36.2 (docs/screens.md "## Phase 36", 36.2; Dylan's approved
// mock-up): filters kept in the address (src/lib/office/updates-view.ts), so a link opens the same
// view: how far back (today, 3, 7 or 30 days; 7 unless chosen), which event (all, or one with
// something in the period) and what kind (a chip each with its count: Needs action, the default,
// to Everything); the list grouped by day (Today, Yesterday, then dates), each update with its
// button; and beside it on a laptop (under it on a phone) "Low on cover", then "Tell me about".
// Updates new since the person last marked them seen are marked "New", and "Mark all as seen"
// clears them and the bell. Opened from the bell in the top bar, the menu, the dashboard's Updates
// column and the pop-up.

const TONE: Record<ReturnType<typeof updateRow>["tone"], { bg: string; icon: IconName }> = {
  done: { bg: "bg-done-tile text-done-ink", icon: "check" },
  urgent: { bg: "bg-urgent-tile text-urgent-ink", icon: "cancel" },
  attention: { bg: "bg-attention-soft text-attention-ink", icon: "clock" },
  wait: { bg: "bg-wait-tile text-ink", icon: "profile" },
};

function Rows({
  items,
  now,
  timeZone,
  seenAt,
  uploads,
  firstOffer,
}: {
  items: PageUpdate[];
  now: Date;
  timeZone: string;
  seenAt: Date | null;
  uploads: boolean; // uploads count as new ("Tell me about")
  firstOffer: PageUpdate | undefined; // the screen's one hi-vis button's update
}) {
  return (
    <ul role="list" className="flex flex-col divide-y divide-line">
      {items.map((u, i) => {
        const r = updateRow(u, now, timeZone);
        const tone = TONE[r.tone];
        const fresh = isNew(u, seenAt, uploads);
        return (
          <li
            key={`${u.kind}-${u.at.getTime()}-${i}`}
            data-new={fresh ? "" : undefined}
            className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0 @min-[36rem]:grid-cols-[2rem_minmax(0,1fr)_auto]"
          >
            <span
              aria-hidden="true"
              className={`flex size-8 items-center justify-center rounded-full ${tone.bg}`}
            >
              <Icon name={tone.icon} size={15} />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                {fresh && (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-accent"
                  />
                )}
                <Link
                  href={r.href}
                  className="press font-medium break-words text-ink hover:underline"
                >
                  {fresh && <span className="sr-only">{NEW_WORD}: </span>}
                  {r.title}
                </Link>
              </span>
              <span className="block text-sm break-words text-ink-muted">{r.line}</span>
            </span>
            <span className="col-start-2 flex flex-wrap items-center gap-3 @min-[36rem]:col-start-3 @min-[36rem]:flex-col @min-[36rem]:items-end @min-[36rem]:gap-2">
              {u.kind !== "open-soon" && (
                <span className="text-xs text-ink-faint tabular-nums">
                  {updateWhen(u.at, now, timeZone)}
                </span>
              )}
              {r.action && (
                <Link
                  href={r.action.href}
                  className={u === firstOffer ? btn.primary : btn.secondary}
                >
                  {r.action.label}
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// The three filters: how far back and which event on one line, what kind under them. Each a link
// to its view (or, for the event, a form): the address holds the view.
function Filters({ data }: { data: UpdatesData }) {
  const { view } = data;
  const to = (change: Partial<UpdatesView>) => updatesViewHref({ ...view, ...change });
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-3" data-updates-filters="">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <nav aria-label={PERIOD_TITLE} className={tabs}>
          {UPDATE_PERIODS.map((p) => (
            <Link
              key={p}
              href={to({ period: p })}
              aria-current={p === view.period ? "page" : undefined}
              className={p === view.period ? tabCurrent : tab}
            >
              {PERIOD_WORDS[p]}
            </Link>
          ))}
        </nav>
        <EventFilter
          label={EVENT_LABEL}
          allWords={ALL_EVENTS}
          chosen={view.eventId}
          events={data.events}
          period={view.period}
          kind={view.kind}
        />
      </div>
      <nav aria-label={KIND_TITLE} className={tabs}>
        {data.kinds.map((k) => (
          <Link
            key={k}
            href={to({ kind: k })}
            aria-current={k === view.kind ? "page" : undefined}
            className={k === view.kind ? tabCurrent : tab}
          >
            {KIND_WORDS[k]}
            {k !== "everything" && (
              <span className={tabCount(k === view.kind)}>{data.counts[k]}</span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function LowOnCover({ data }: { data: UpdatesData }) {
  return (
    <section
      id="low-on-cover"
      aria-labelledby="low-on-cover-title"
      className="glass flex flex-col gap-3 rounded-inner p-4"
    >
      <div className="px-1">
        <h2
          id="low-on-cover-title"
          className="flex items-center gap-2 text-lg font-semibold text-ink"
        >
          <Icon name="shifts" size={16} className="text-ink-muted" />
          {LOW_COVER_TITLE}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{LOW_COVER_LINE}</p>
      </div>
      {data.lowCover.length === 0 ? (
        <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">{LOW_COVER_NONE}</p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {data.lowCover.map((c) => {
            const when = lowCoverWhen(c.firstStart, data.now, data.timeZone);
            const pct = coverPercent(c);
            return (
              <li key={c.eventId}>
                <Link
                  href={`/office/events/${c.eventId}`}
                  className="press flex min-h-11 flex-col gap-2 rounded-row glass-tile p-3 hover:bg-active"
                >
                  <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <b className="min-w-0 font-semibold break-words text-ink">{c.name}</b>
                    <StatusChip tone={when.soon ? "attention" : "quiet"}>{when.words}</StatusChip>
                  </span>
                  <span className="text-sm text-ink-muted tabular-nums">{lowCoverLine(c)}</span>
                  <span
                    aria-hidden="true"
                    className="block h-1.5 overflow-hidden rounded-full bg-track"
                  >
                    <span
                      className={`block h-full rounded-full ${pct < 50 ? "bg-mark-urgent" : "bg-mark-open"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/office/events" className={`${quietLink} self-start px-1`}>
        {LOW_COVER_ALL}
        <Icon name="arrow" size={14} />
      </Link>
    </section>
  );
}

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm, officeUser } = await requireOfficeArea("today");
  const view = parseUpdatesView(await searchParams);
  const data = await officeUpdatesPage({ firm, officeUserId: officeUser.id }, view);
  if (!data) notFound();
  const { now, timeZone, seenAt } = data;
  const groups = groupByDay(data.shown, now, timeZone);
  // One hi-vis button on the screen (round 8, sys-3): the first "Offer the place"; the rest are
  // ordinary buttons with the same words and link.
  const firstOffer = data.shown.find(
    (u) => updateRow(u, now, timeZone).action?.label === "Offer the place",
  );
  const uploads = data.tellMe.includes("uploads");
  return (
    <main className={`${page.office} @container`}>
      <PageHeader
        title={UPDATES_TITLE}
        actions={<MarkSeen shownAt={now.toISOString()} newCount={data.newCount} />}
      >
        <p className="text-sm text-ink-muted">{updatesLine(data.mine)}</p>
      </PageHeader>
      <Filters data={data} />
      {/* The list, and "Low on cover" and "Tell me about" beside it from a laptop's width (under it
          before). */}
      <div className="grid items-start gap-4 @min-[64rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section
          id="updates-list"
          aria-labelledby="updates-today"
          className="glass min-w-0 rounded-inner p-4"
        >
          <h2
            id="updates-today"
            className="mb-3 flex flex-wrap items-center gap-x-2 px-1 text-lg font-semibold text-ink"
          >
            <Icon name="bell" size={16} className="text-ink-muted" />
            {KIND_WORDS[data.view.kind]}
            <span className="text-sm font-normal text-ink-muted tabular-nums">
              · {PERIOD_HEADINGS[data.view.period]}
              {data.today > 0 && data.view.period !== "today" && ` · ${newTodayWords(data.today)}`}
            </span>
          </h2>
          {groups.length === 0 ? (
            <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">
              {nothingText(data.view.kind, data.view.period, data.view.eventId !== null)}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g) => (
                <section key={g.day} aria-labelledby={`day-${g.day}`}>
                  <h3
                    id={`day-${g.day}`}
                    className="px-1 pt-1 pb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase"
                  >
                    {g.label}
                  </h3>
                  <Rows
                    items={g.items}
                    now={now}
                    timeZone={timeZone}
                    seenAt={seenAt}
                    uploads={uploads}
                    firstOffer={firstOffer}
                  />
                </section>
              ))}
            </div>
          )}
          <p className="mt-4 px-1 text-sm text-ink-muted">
            {data.more && `${showingNewest(UPDATES_PAGE_SHOWN)} `}
            <Link href="/office/log" className="underline underline-offset-2">
              {MORE_IN_LOG}
            </Link>
          </p>
        </section>
        <div className="flex min-w-0 flex-col gap-4">
          <LowOnCover data={data} />
          <TellMePanel
            tellMe={data.tellMe}
            mine={data.mine}
            publicKey={appEnv().VAPID_PUBLIC_KEY ?? null}
          />
        </div>
      </div>
    </main>
  );
}
