import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  meta,
  nums,
  page,
  tab,
  tabCount,
  tabCurrent,
  tabs,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { initials } from "@/lib/office/board-copy";
import {
  CASUAL_SORTS,
  CASUAL_VIEWS,
  CASUALS_PAGE_MAX,
  casualsList,
  type CasualRow,
  type CasualSort,
  type CasualView,
  type WaitingUpload,
} from "@/lib/office/casuals";
import {
  CASUAL_VIEW_EMPTY,
  CASUAL_VIEW_WORDS,
  casualsLine,
  COUNT_VIEWS,
  countLine,
  NEEDS_DEFAULT_SORT,
  outOfDate,
  REMIND_LINE,
  reminderText,
  SORT_WORDS,
  sortedText,
  strikesText,
} from "@/lib/office/casuals-copy";
import { clockTime } from "@/lib/office/session-page-copy";
import { ReliabilityBar } from "../reliability-bar";
import { CasualMenu, RemindAll, RemindButton } from "./follow-up";
import { Icon } from "@/app/ui/icons";
import { STATUS_WORDS as ACCESS_WORDS } from "@/lib/office/worker-copy";
import { roleLabel } from "@/lib/portal/format";
import { qualificationTitle } from "@/lib/portal/qualification-copy";
import { uploadWhat } from "@/lib/portal/upload-copy";
import { shortDate } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { officeTravelText } from "@/lib/travel/copy";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";
import { PhotoCell, Tags } from "./casual-cells";

export const metadata: Metadata = { title: "Casuals" };

const isView = (v: unknown): v is CasualView =>
  typeof v === "string" && (CASUAL_VIEWS as readonly string[]).includes(v);
const isSort = (v: unknown): v is CasualSort =>
  typeof v === "string" && (CASUAL_SORTS as readonly string[]).includes(v);
const hrefOf = (view: CasualView, sort: CasualSort = "default") => {
  const q = new URLSearchParams();
  if (view !== "all") q.set("view", view);
  if (sort !== "default") q.set("sort", sort);
  const s = q.toString();
  return s ? `/office/casuals?${s}` : "/office/casuals";
};

// Their initials in a small glass disc beside their name (decorative: the name is next to it).
function Initials({ row }: { row: CasualRow }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wait-tile text-xs font-semibold text-wait-ink glass-rim"
    >
      {initials(row.name)}
    </span>
  );
}

// "Steward, Door supervisor" (and " · Not active" or " · Blocked" when they can't work).
const who = (row: CasualRow) =>
  `${row.roles.map(roleLabel).join(", ") || "No roles"}${
    row.status === "active" ? "" : ` · ${ACCESS_WORDS[row.status]}`
  }`;

// Live strikes: "None", or the number in red (it counts against them).
function Strikes({ n }: { n: number }) {
  return (
    <span className={`tabular-nums ${n > 0 ? "font-semibold text-urgent" : "text-ink"}`}>
      {strikesText(n)}
    </span>
  );
}

// Uploads to check: every photo and certificate waiting, oldest first, as rows of one glass
// panel; each opens the casual's page, where it's approved or rejected.
function UploadsList({
  uploads,
  timeZone,
  year,
}: {
  uploads: WaitingUpload[];
  timeZone: string;
  year: number;
}) {
  return (
    <ul role="list" className="glass flex flex-col gap-1 rounded-inner p-2">
      {uploads.map((u) => (
        <li
          key={u.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-row px-4 py-3"
        >
          <span className="min-w-0">
            <Link
              href={`/office/casuals/${u.workerId}#uploads`}
              className={`font-semibold ${textLink}`}
            >
              {u.name}
            </Link>
            <span className={`block ${meta}`}>
              {uploadWhat(
                u.kind,
                u.qualificationName ? qualificationTitle(u.qualificationName) : null,
              )}{" "}
              · sent{" "}
              <span className={nums}>{shortDate(localDateOf(u.sentAt, timeZone), year)}</span>
            </span>
          </span>
          <Link href={`/office/casuals/${u.workerId}#uploads`} className={btn.secondary}>
            Check it
          </Link>
        </li>
      ))}
    </ul>
  );
}

// The table's head and cells (round 7: one glass table, no lines between its rows).
const th = "px-4 pt-4 pb-3 text-xs font-medium whitespace-nowrap text-ink-muted";
const td = "px-4 py-3 align-middle";

// Casuals, round 8 (Phase 26.7, cas-1 to cas-6; docs/screens.md "Casuals, round 8"): "Casuals",
// how many and over what time, the search and (on Need updating) "Remind all N"; four counts
// (Regulars, Reliable, Cancel often, Not worked lately), each opening its tab; tabs with their
// counts and the sort; then the list: everyone's reliability (worked out by code over 90 days),
// last worked and strikes beside their qualifications, photo and travel area; on Need updating,
// what's out of date, the last reminder, "Remind" and the row's "…" (Call, Add a note, Mark as
// sorted). One glass table from 768px, stacked cards on a phone. Admins and resourcers.
export default async function OfficeCasualsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("casuals");
  const { view: viewParam, sort: sortParam } = await searchParams;
  const view: CasualView = isView(viewParam) ? viewParam : "all";
  const sort: CasualSort = isSort(sortParam) ? sortParam : "default";
  const list = await casualsList({ firm, officeUserId: officeUser.id }, view, sort);
  if (!list) notFound();
  const timeZone = firm.timezone;
  const now = new Date();
  const today = localDateOf(now, timeZone);
  const year = Number(today.slice(0, 4));
  const when = (d: Date) =>
    localDateOf(d, timeZone) === today
      ? clockTime(d, timeZone)
      : shortDate(localDateOf(d, timeZone), year);
  const lastWorked = (r: CasualRow) =>
    r.record.lastWorked ? shortDate(localDateOf(r.record.lastWorked, timeZone), year) : "Never";
  const needsView = view === "needs";
  return (
    <main className={page.office}>
      <PageHeader
        title="Casuals"
        actions={
          <>
            <div className="w-full sm:w-auto">
              <FindWorkerForm
                find={findWorkersAction}
                hrefBase="/office/casuals"
                notAllowed="You can't see casuals."
                compact
              />
            </div>
            {needsView && <RemindAll workerIds={list.remindAll} />}
          </>
        }
      >
        <p>{casualsLine(list.counts.all)}</p>
      </PageHeader>

      <ul
        role="list"
        aria-label="Counts"
        className="glass mb-4 grid grid-cols-2 overflow-hidden rounded-inner md:grid-cols-4"
      >
        {COUNT_VIEWS.map((v) => (
          <li
            key={v}
            className="border-line not-last:border-r max-md:even:border-r-0 max-md:[&:nth-child(-n+2)]:border-b"
          >
            <Link
              href={hrefOf(v)}
              aria-current={v === view ? "page" : undefined}
              className="press flex h-full flex-col gap-1 p-4 hover:bg-button-hover"
            >
              <span className="text-sm text-ink-muted">{CASUAL_VIEW_WORDS[v]}</span>
              <span
                className={`text-3xl font-semibold tabular-nums ${
                  v === "cancel_often" && list.counts[v] > 0 ? "text-urgent" : "text-ink"
                }`}
              >
                {list.counts[v]}
              </span>
              <span className="text-sm text-ink-muted">{countLine(v, list.withFigure)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label="Show" className={tabs}>
          {CASUAL_VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefOf(v, sort)}
              aria-current={v === view ? "page" : undefined}
              className={v === view ? tabCurrent : tab}
            >
              {CASUAL_VIEW_WORDS[v]} <span className={tabCount(v === view)}>{list.counts[v]}</span>
            </Link>
          ))}
        </nav>
        {view !== "uploads" && (
          <details className="group relative sm:ml-auto">
            <summary className="press-glass glass-button inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full px-4 text-sm font-medium text-ink hover:bg-button-hover [&::-webkit-details-marker]:hidden">
              <Icon name="data" size={16} />
              {sort === "default" && needsView ? NEEDS_DEFAULT_SORT : SORT_WORDS[sort]}
            </summary>
            <div className="absolute top-full right-0 z-20 mt-2 flex w-64 flex-col gap-1 rounded-inner glass-float p-2">
              {CASUAL_SORTS.map((s) => (
                <Link
                  key={s}
                  href={hrefOf(view, s)}
                  aria-current={s === sort ? "true" : undefined}
                  className="press flex min-h-11 items-center rounded-row px-3 text-sm text-ink hover:bg-button-hover aria-[current]:font-semibold"
                >
                  {s === "default" && needsView ? NEEDS_DEFAULT_SORT : SORT_WORDS[s]}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      <section className="mt-6" aria-labelledby="list">
        <h2 id="list" className="sr-only">
          {CASUAL_VIEW_WORDS[view]}
        </h2>
        {view === "uploads" ? (
          list.uploads.length === 0 ? (
            <p className={`${card} text-ink-muted`}>{CASUAL_VIEW_EMPTY[view]}</p>
          ) : (
            <UploadsList uploads={list.uploads} timeZone={timeZone} year={year} />
          )
        ) : list.rows.length === 0 ? (
          <p className={`${card} text-ink-muted`}>{CASUAL_VIEW_EMPTY[view]}</p>
        ) : (
          <>
            {/* A table from 768px; stacked cards on a phone. */}
            <div
              role="region"
              tabIndex={0}
              aria-label={`${CASUAL_VIEW_WORDS[view]}: casuals`}
              className="glass hidden overflow-x-auto rounded-inner px-2 pb-2 md:block"
            >
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className={th}>Casual</th>
                    {needsView ? (
                      <>
                        <th className={th}>Out of date</th>
                        <th className={th}>Last reminder</th>
                      </>
                    ) : (
                      <>
                        <th className={th}>Qualifications</th>
                        <th className={th}>Staff photo</th>
                        {list.travelOn && <th className={th}>Travel area</th>}
                        <th className={th}>Live strikes</th>
                        <th className={th}>Last worked</th>
                      </>
                    )}
                    <th className={th}>Reliability</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id} data-casual={r.id}>
                      <td className={`${td} min-w-56`}>
                        <span className="flex items-center gap-3">
                          <Initials row={r} />
                          <span className="min-w-0">
                            <Link
                              href={`/office/casuals/${r.id}`}
                              className="press font-semibold text-ink underline-offset-4 hover:underline"
                            >
                              {r.name}
                            </Link>
                            <span className="block text-sm text-ink-muted">{who(r)}</span>
                            {r.note && (
                              <span className="block max-w-64 truncate text-sm text-ink-faint">
                                Note: {r.note.body}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      {needsView ? (
                        <>
                          <td className={`${td} min-w-56`}>
                            <OutOfDate row={r} year={year} />
                          </td>
                          <td className={`${td} min-w-44 text-sm text-ink-muted`}>
                            {r.sorted
                              ? sortedText(r.sorted, when)
                              : reminderText(r.lastReminder, when)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`${td} min-w-56`}>
                            <Tags row={r} year={year} />
                          </td>
                          <td className={`${td} min-w-36`}>
                            <PhotoCell row={r} year={year} />
                          </td>
                          {list.travelOn && (
                            <td className={`${td} min-w-40 text-sm ${nums}`}>
                              {officeTravelText(r.travel)}
                            </td>
                          )}
                          <td className={td}>
                            <Strikes n={r.liveStrikes} />
                          </td>
                          <td className={`${td} text-sm whitespace-nowrap ${nums}`}>
                            {lastWorked(r)}
                          </td>
                        </>
                      )}
                      <td className={`${td} min-w-32`}>
                        <ReliabilityBar reliability={r.record.reliability} />
                      </td>
                      <td className={`${td} text-right`}>
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          {needsView && r.remindAbout && !r.sorted && (
                            <RemindButton workerId={r.id} name={r.name} />
                          )}
                          <CasualMenu
                            workerId={r.id}
                            name={r.name}
                            mobile={r.mobile}
                            canSort={r.needs.length > 0 || r.photoNeeds}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul role="list" className="flex flex-col gap-3 md:hidden">
              {list.rows.map((r) => (
                <li key={r.id} className={card}>
                  <div className="flex items-center gap-3">
                    <Initials row={r} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/office/casuals/${r.id}`}
                        className={`font-semibold ${textLink}`}
                      >
                        {r.name}
                      </Link>
                      <p className={meta}>{who(r)}</p>
                    </div>
                    <CasualMenu
                      workerId={r.id}
                      name={r.name}
                      mobile={r.mobile}
                      canSort={r.needs.length > 0 || r.photoNeeds}
                    />
                  </div>
                  <div className="mt-3">
                    {needsView ? <OutOfDate row={r} year={year} /> : <Tags row={r} year={year} />}
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="font-semibold">Reliability</dt>
                    <dd>
                      <ReliabilityBar reliability={r.record.reliability} />
                    </dd>
                    {needsView ? (
                      <>
                        <dt className="font-semibold">Last reminder</dt>
                        <dd>
                          {r.sorted
                            ? sortedText(r.sorted, when)
                            : reminderText(r.lastReminder, when)}
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt className="font-semibold">Staff photo</dt>
                        <dd>
                          <PhotoCell row={r} year={year} />
                        </dd>
                        {list.travelOn && (
                          <>
                            <dt className="font-semibold">Travel area</dt>
                            <dd className={nums}>{officeTravelText(r.travel)}</dd>
                          </>
                        )}
                        <dt className="font-semibold">Live strikes</dt>
                        <dd>
                          <Strikes n={r.liveStrikes} />
                        </dd>
                        <dt className="font-semibold">Last worked</dt>
                        <dd className={nums}>{lastWorked(r)}</dd>
                      </>
                    )}
                  </dl>
                  {needsView && r.remindAbout && !r.sorted && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <RemindButton workerId={r.id} name={r.name} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {needsView && <p className={`${meta} mt-3 px-1`}>{REMIND_LINE}</p>}
            {list.more && (
              <p className={`${meta} mt-3`}>
                Showing the first {CASUALS_PAGE_MAX}. Search by name or mobile number to find anyone
                else.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

// What's out of date (Need updating): each as a red or amber chip (not a list: the row is one).
function OutOfDate({ row, year }: { row: CasualRow; year: number }) {
  const chips = outOfDate(row.needs, row.photo, row.photoNeeds, year);
  return (
    <span className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <span
          key={c}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${
            /expired|missing|overdue|booked shift/.test(c)
              ? "bg-urgent-soft text-urgent-ink"
              : "bg-attention-soft text-attention-ink"
          }`}
        >
          {c}
        </span>
      ))}
      {row.liveStrikes > 0 && (
        <span className="inline-flex items-center rounded-full bg-urgent-fill px-3 py-1 text-sm font-medium text-on-urgent">
          {row.liveStrikes} live {row.liveStrikes === 1 ? "strike" : "strikes"}
        </span>
      )}
    </span>
  );
}
