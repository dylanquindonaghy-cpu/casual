import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, field, label, page, sectionGap, table, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { dayWithYear } from "@/lib/office/action-log";
import {
  FILTER_KIND_WORDS,
  INITIATOR_WORDS,
  KIND_WORDS,
  officeNoticeReport,
  parseNoticeQuery,
  REPORT_KINDS,
  REPORT_CSV_ROWS,
  REPORT_PAGE_ROWS,
  shiftWords,
  spanWords,
  whenWords,
  type OfficeNoticeReport as NoticeReport,
  type ReportKind,
} from "@/lib/office/notice-report";
import { noticeText } from "@/lib/portal/cancel-reasons";

export const metadata: Metadata = { title: "Notice and cancellation report" };

// Column headings stay in view while the rows scroll (the table's region has a height limit). The
// region pads its scrolling top by more than the heading row (about 37px) plus a focus ring (4px),
// so a link the browser scrolls to, or one reached with Shift+Tab, never sits under the headings
// (WCAG 2.4.11).
const th = `${table.th} sticky top-0 z-10 whitespace-nowrap`;
const region = `${table.wrap} mt-3 max-h-[75dvh] scroll-pt-12`;
const td = table.td;
// One field of the filter bar, its label above it.
const filter = "flex flex-col gap-1";

function query(filters: NoticeReport["filters"]): string {
  const q = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.kind) q.set("kind", filters.kind);
  if (filters.by) q.set("by", filters.by);
  if (filters.shortOnly) q.set("short", "1");
  return q.toString();
}

const THRESHOLD_WORDS: Record<NoticeReport["threshold"]["source"], string> = {
  setting: "your firm's setting",
  default: "your firm hasn't set its own, so the usual one is used",
  invalid: "your firm's setting isn't a number of hours from 1 to 720, so the usual 48 is used",
};

// The notice as the office reads it: "2 days' notice (71.99 hours)", or after the start.
function noticeWords(hours: number): string {
  if (hours < 0) return `After the start (${Math.abs(hours).toFixed(2)} hours after)`;
  return `${noticeText(hours).replace(/^./, (c) => c.toUpperCase())} (${hours.toFixed(2)} hours)`;
}

// The notice and cancellation report (docs/screens.md `/office/reports/notice`): every offer,
// booking, move, shortening and cancellation, with when, who started it and the notice the worker
// had, flagged under the firm's short-notice threshold; a CSV of the same. Admins and resourcers.
// Layout (docs/ui-design.md "Report table"): the filters as one bar, the count and the download,
// then the table in a labelled region that scrolls (sideways on a phone; its headings stay in
// view). A short-notice row is tinted and its "Yes" is a red chip (the word is still the cell's
// whole text, so the CSV and the page say the same).
export default async function NoticeReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm } = await requireOfficeArea("reports");
  const report = await officeNoticeReport(
    { firm },
    (await readSessionToken("office")) ?? "",
    parseNoticeQuery(await searchParams),
  );
  if (!report) notFound();
  const f = report.filters;
  const tz = report.timeZone;
  return (
    <main className={page.office}>
      <PageHeader title="Notice and cancellation report">
        <p>
          Every offer, booking, move, shortening and cancellation: when, who started it, and how
          much notice the worker had.
        </p>
        <p>
          Short notice means under {report.threshold.hours} hours (
          {THRESHOLD_WORDS[report.threshold.source]}). The 2027 rules aren&apos;t final yet.
        </p>
      </PageHeader>

      <form
        method="get"
        className={`${card} grid grid-cols-2 items-end gap-x-4 gap-y-4 sm:flex sm:flex-wrap`}
      >
        <div className={filter}>
          <label htmlFor="report-from" className={label}>
            From
          </label>
          <input
            id="report-from"
            type="date"
            name="from"
            defaultValue={f.from}
            className={`${field} w-full sm:w-44`}
          />
        </div>
        <div className={filter}>
          <label htmlFor="report-to" className={label}>
            To
          </label>
          <input
            id="report-to"
            type="date"
            name="to"
            defaultValue={f.to}
            className={`${field} w-full sm:w-44`}
          />
        </div>
        <div className={`${filter} col-span-2`}>
          <label htmlFor="report-kind" className={label}>
            What
          </label>
          <select
            id="report-kind"
            name="kind"
            defaultValue={f.kind ?? ""}
            className={`${field} w-full sm:w-56`}
          >
            <option value="">Everything</option>
            {(Object.keys(REPORT_KINDS) as ReportKind[]).map((k) => (
              <option key={k} value={k}>
                {FILTER_KIND_WORDS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className={filter}>
          <label htmlFor="report-by" className={label}>
            Started by
          </label>
          <select
            id="report-by"
            name="by"
            defaultValue={f.by ?? ""}
            className={`${field} w-full sm:w-40`}
          >
            <option value="">Anyone</option>
            <option value="firm">The firm</option>
            <option value="worker">The worker</option>
          </select>
        </div>
        {/* The tick box and "Show" wrap onto a new line together on a desk (a grid on a phone). */}
        <div className="contents sm:flex sm:items-center sm:gap-x-6">
          <div className="flex min-h-11 items-center gap-2">
            <input
              id="report-short"
              type="checkbox"
              name="short"
              value="1"
              defaultChecked={f.shortOnly}
              className="h-5 w-5 shrink-0 accent-ink"
            />
            <label htmlFor="report-short" className={label}>
              Short notice only
            </label>
          </div>
          <button type="submit" className={`${btn.primary} col-span-2`}>
            Show
          </button>
        </div>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="font-semibold tabular-nums">
          {dayWithYear(f.from, report.thisYear)} to {dayWithYear(f.to, report.thisYear)}:{" "}
          {report.total === 1 ? "1 row" : `${report.total} rows`}.
          {report.clamped ? " At most a year at a time." : ""}
          {report.total > REPORT_PAGE_ROWS ? ` Showing the newest ${REPORT_PAGE_ROWS}.` : ""}
        </p>
        <p className="max-w-prose">
          {report.total > REPORT_CSV_ROWS ? (
            `A file holds at most ${REPORT_CSV_ROWS.toLocaleString("en-GB")} rows, so these dates can't be downloaded in one. Choose fewer days.`
          ) : (
            <a href={`/office/reports/notice/export?${query(f)}`} className={btn.secondary}>
              Download as a spreadsheet (CSV)
            </a>
          )}
        </p>
      </div>

      {report.rows.length === 0 ? (
        <p className={`${card} mt-3 text-ink-muted`}>Nothing in these dates.</p>
      ) : (
        <div
          role="region"
          tabIndex={0}
          aria-label="Notice and cancellation report"
          className={region}
        >
          <table className={table.table}>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>What</th>
                <th className={th}>Started by</th>
                <th className={th}>Worker</th>
                <th className={th}>Shift</th>
                <th className={`${th} ${table.num}`}>Notice</th>
                <th className={th}>Short notice</th>
                <th className={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {/* Keyed by position: event numbers are shared by every firm (audit L44). */}
              {report.rows.map((r, i) => (
                <tr key={i} className={r.shortNotice ? "bg-urgent-soft" : undefined}>
                  <td className={`${td} min-w-24 tabular-nums`}>
                    {whenWords(r.at, tz, report.thisYear)}
                  </td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{KIND_WORDS[r.kind]}</td>
                  <td className={`${td} whitespace-nowrap`}>{INITIATOR_WORDS[r.initiator]}</td>
                  <td className={`${td} min-w-28`}>{r.worker}</td>
                  <td className={`${td} min-w-52`}>
                    {r.shift ? (
                      <Link
                        href={`/office/shifts/${r.shift.id}`}
                        className={`font-medium text-ink ${textLink}`}
                      >
                        {shiftWords(r.shift, tz, report.thisYear)}
                      </Link>
                    ) : (
                      shiftWords(null, tz, report.thisYear)
                    )}
                    {r.moved && (
                      <span className="mt-1 block text-ink-muted">
                        Was {spanWords(r.moved.fromStart, r.moved.fromEnd, tz, report.thisYear)};
                        now {spanWords(r.moved.toStart, r.moved.toEnd, tz, report.thisYear)}.
                        {r.moved.siteChanged ? " The site changed." : ""}
                      </span>
                    )}
                  </td>
                  <td className={`${td} ${table.num} min-w-32`}>
                    {r.noticeHours === null ? "Not recorded" : noticeWords(r.noticeHours)}
                    {r.noticeFromCurrentStart ? " (from the current start)" : ""}
                  </td>
                  <td className={td}>
                    {r.shortNotice ? (
                      <StatusChip tone="urgent">Yes</StatusChip>
                    ) : (
                      <span className="text-ink-muted">No</span>
                    )}
                  </td>
                  <td className={`${td} min-w-24`}>{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}
