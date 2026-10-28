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
  CASUAL_VIEWS,
  CASUALS_PAGE_MAX,
  casualsList,
  type CasualRow,
  type CasualView,
  type WaitingUpload,
} from "@/lib/office/casuals";
import {
  CASUAL_VIEW_EMPTY,
  CASUAL_VIEW_WORDS,
  needsLine,
  strikesText,
} from "@/lib/office/casuals-copy";
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
const hrefOf = (view: CasualView) =>
  view === "all" ? "/office/casuals" : `/office/casuals?view=${view}`;

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
const th = "px-4 pt-4 pb-3 text-sm font-medium whitespace-nowrap text-ink-muted";
const td = "px-4 py-3 align-middle";

// Casuals (docs/office-v2.md 3.7; docs/screens.md `/office/casuals`; 12F.1; Phase 24, 24.4: round
// 7 of the canvas, approved by Dylan on 26 Oct 2026): "Casuals" and what it's for; All, Need
// updating and Uploads to check as links with their counts, and beside them the search ("Name or
// mobile number", the find-a-worker form as built, in a box: ../find-worker-form.tsx); then
// everyone in the view as one glass table from 768px (their initials, name and roles,
// qualifications with their dates, staff photo, travel area, live strikes in red, what needs
// updating), stacked glass cards on a phone. Admins and resourcers.
export default async function OfficeCasualsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("casuals");
  const { view: viewParam } = await searchParams;
  const view: CasualView = isView(viewParam) ? viewParam : "all";
  const list = await casualsList({ firm, officeUserId: officeUser.id }, view);
  if (!list) notFound();
  const timeZone = firm.timezone;
  const year = Number(localDateOf(new Date(), timeZone).slice(0, 4));
  return (
    <main className={page.office}>
      <PageHeader title="Casuals">
        <p>
          {list.travelOn
            ? "Their qualifications, travel areas and strikes."
            : "Their qualifications and strikes."}{" "}
          Open someone to see more, or to change their access when they leave, come back or lose
          their phone.
        </p>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label="Show" className={tabs}>
          {CASUAL_VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefOf(v)}
              aria-current={v === view ? "page" : undefined}
              className={v === view ? tabCurrent : tab}
            >
              {CASUAL_VIEW_WORDS[v]} <span className={tabCount(v === view)}>{list.counts[v]}</span>
            </Link>
          ))}
        </nav>
        <div className="w-full sm:ml-auto sm:w-auto">
          <FindWorkerForm
            find={findWorkersAction}
            hrefBase="/office/casuals"
            notAllowed="You can't see casuals."
            compact
          />
        </div>
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
                    <th className={th}>Qualifications</th>
                    <th className={th}>Staff photo</th>
                    {list.travelOn && <th className={th}>Travel area</th>}
                    <th className={th}>Live strikes</th>
                    <th className={th}>Needs updating</th>
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
                          </span>
                        </span>
                      </td>
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
                      <td className={`${td} min-w-40 text-sm`}>{needsLine(r.needs, year)}</td>
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
                    <div className="min-w-0">
                      <Link
                        href={`/office/casuals/${r.id}`}
                        className={`font-semibold ${textLink}`}
                      >
                        {r.name}
                      </Link>
                      <p className={meta}>{who(r)}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Tags row={r} year={year} />
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
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
                    <dt className="font-semibold">Needs updating</dt>
                    <dd>{needsLine(r.needs, year)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
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
