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
} from "@/lib/office/updates";
import {
  MORE_IN_LOG,
  NEW_WORD,
  NOTHING_AT_ALL,
  NOTHING_TO_ACT_ON,
  LAST_7_DAYS,
  newTodayWords,
  showingNewest,
  UPDATE_VIEWS,
  UPDATES_TITLE,
  updateRow,
  updatesHref,
  updatesLine,
  VIEW_WORDS,
  type UpdateView,
} from "@/lib/office/updates-copy";
import { btn, page, tab, tabCount, tabCurrent, tabs } from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { MarkSeen } from "./mark-seen";
import { TellMePanel } from "./tell-me-panel";

export const metadata: Metadata = { title: "Updates" };

// Updates (Phase 26.4; docs/screens.md "Updates"; the mock-up's Updates): what happened on the
// person's contracts over the last week. The list's heading says so, and how many came in today; its two
// views are "Needs action" (the default: each with its button) and "Everything". Updates new since
// the person last marked them seen are marked "New", and "Mark all as seen" clears them and the
// bell. Opened from the bell in the top bar, the menu, the dashboard's Updates column and the pop-up.

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
}: {
  items: PageUpdate[];
  now: Date;
  timeZone: string;
  seenAt: Date | null;
  uploads: boolean; // uploads count as new ("Tell me about")
}) {
  // One hi-vis button on the screen (round 8, sys-3): the first "Offer the place"; the rest are
  // ordinary buttons with the same words and link.
  const firstOffer = items.findIndex(
    (u) => updateRow(u, now, timeZone).action?.label === "Offer the place",
  );
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
                <Link href={r.href} className="press font-medium text-ink hover:underline">
                  {fresh && <span className="sr-only">{NEW_WORD}: </span>}
                  {r.title}
                </Link>
              </span>
              <span className="block text-sm text-ink-muted">{r.line}</span>
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
                  className={i === firstOffer ? btn.primary : btn.secondary}
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

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("today");
  const { view: viewParam } = await searchParams;
  const view: UpdateView = viewParam === "everything" ? "everything" : "action";
  const data = await officeUpdatesPage({ firm, officeUserId: officeUser.id });
  if (!data) notFound();
  const { now, timeZone, seenAt } = data;
  const items = view === "action" ? data.needsAction : data.everything;
  return (
    <main className={`${page.office} @container`}>
      <PageHeader
        title={UPDATES_TITLE}
        actions={<MarkSeen shownAt={now.toISOString()} newCount={data.newCount} />}
      >
        <p className="text-sm text-ink-muted">{updatesLine(data.mine)}</p>
      </PageHeader>
      {/* The list, and "Tell me about" beside it from a laptop's width (under it before). */}
      <div className="grid items-start gap-4 @min-[64rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section
          id="updates-list"
          aria-labelledby="updates-today"
          className="glass rounded-inner p-4"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="updates-today"
              className="flex items-center gap-2 px-1 text-lg font-semibold text-ink"
            >
              <Icon name="bell" size={16} className="text-ink-muted" />
              {LAST_7_DAYS}
              {data.today > 0 && (
                <span className="text-sm font-normal text-ink-muted tabular-nums">
                  · {newTodayWords(data.today)}
                </span>
              )}
            </h2>
            <nav aria-label="Show" className={tabs}>
              {UPDATE_VIEWS.map((v) => (
                <Link
                  key={v}
                  href={updatesHref(v)}
                  aria-current={v === view ? "page" : undefined}
                  className={v === view ? tabCurrent : tab}
                >
                  {VIEW_WORDS[v]}
                  {v === "action" && (
                    <span className={tabCount(v === view)}>{data.needsAction.length}</span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          {items.length === 0 ? (
            <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">
              {view === "action" ? NOTHING_TO_ACT_ON : NOTHING_AT_ALL}
            </p>
          ) : (
            <Rows
              items={items}
              now={now}
              timeZone={timeZone}
              seenAt={seenAt}
              uploads={data.tellMe.includes("uploads")}
            />
          )}
          <p className="mt-4 px-1 text-sm text-ink-muted">
            {data.more && view === "everything" && `${showingNewest(UPDATES_PAGE_SHOWN)} `}
            <Link href="/office/log" className="underline underline-offset-2">
              {MORE_IN_LOG}
            </Link>
          </p>
        </section>
        <TellMePanel
          tellMe={data.tellMe}
          mine={data.mine}
          publicKey={appEnv().VAPID_PUBLIC_KEY ?? null}
        />
      </div>
    </main>
  );
}
