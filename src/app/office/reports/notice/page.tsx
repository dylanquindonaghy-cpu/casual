import Link from "next/link";
import { notFound } from "next/navigation";
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

const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";
const field = "rounded border border-slate-400 px-2 py-1";
const cell = "border-b border-slate-200 px-2 py-2 align-top";

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
    <main className="mx-auto max-w-5xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Notice and cancellation report</h1>
      <p className="mt-2">
        Every offer, booking, move, shortening and cancellation: when, who started it, and how much
        notice the worker had.
      </p>
      <p className="mt-2">
        Short notice means under {report.threshold.hours} hours (
        {THRESHOLD_WORDS[report.threshold.source]}). The 2027 rules aren&apos;t final yet.
      </p>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="report-from" className="font-semibold">
            From
          </label>
          <input id="report-from" type="date" name="from" defaultValue={f.from} className={field} />
        </div>
        <div className="flex flex-col">
          <label htmlFor="report-to" className="font-semibold">
            To
          </label>
          <input id="report-to" type="date" name="to" defaultValue={f.to} className={field} />
        </div>
        <div className="flex flex-col">
          <label htmlFor="report-kind" className="font-semibold">
            What
          </label>
          <select id="report-kind" name="kind" defaultValue={f.kind ?? ""} className={field}>
            <option value="">Everything</option>
            {(Object.keys(REPORT_KINDS) as ReportKind[]).map((k) => (
              <option key={k} value={k}>
                {FILTER_KIND_WORDS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="report-by" className="font-semibold">
            Started by
          </label>
          <select id="report-by" name="by" defaultValue={f.by ?? ""} className={field}>
            <option value="">Anyone</option>
            <option value="firm">The firm</option>
            <option value="worker">The worker</option>
          </select>
        </div>
        <div className="flex items-center gap-2 self-center">
          <input
            id="report-short"
            type="checkbox"
            name="short"
            value="1"
            defaultChecked={f.shortOnly}
          />
          <label htmlFor="report-short">Short notice only</label>
        </div>
        <button type="submit" className={button}>
          Show
        </button>
      </form>

      <p className="mt-4">
        {dayWithYear(f.from, report.thisYear)} to {dayWithYear(f.to, report.thisYear)}:{" "}
        {report.total === 1 ? "1 row" : `${report.total} rows`}.
        {report.clamped ? " At most a year at a time." : ""}
        {report.total > REPORT_PAGE_ROWS ? ` Showing the newest ${REPORT_PAGE_ROWS}.` : ""}
      </p>
      <p className="mt-2">
        {report.total > REPORT_CSV_ROWS ? (
          `A file holds at most ${REPORT_CSV_ROWS.toLocaleString("en-GB")} rows, so these dates can't be downloaded in one. Choose fewer days.`
        ) : (
          <a href={`/office/reports/notice/export?${query(f)}`} className={button}>
            Download as a spreadsheet (CSV)
          </a>
        )}
      </p>

      {report.rows.length === 0 ? (
        <p className="mt-4">Nothing in these dates.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-base">
            <thead>
              <tr>
                <th className={cell}>When</th>
                <th className={cell}>What</th>
                <th className={cell}>Started by</th>
                <th className={cell}>Worker</th>
                <th className={cell}>Shift</th>
                <th className={cell}>Notice</th>
                <th className={cell}>Short notice</th>
                <th className={cell}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {/* Keyed by position: event numbers are shared by every firm (audit L44). */}
              {report.rows.map((r, i) => (
                <tr key={i}>
                  <td className={cell}>{whenWords(r.at, tz, report.thisYear)}</td>
                  <td className={cell}>{KIND_WORDS[r.kind]}</td>
                  <td className={cell}>{INITIATOR_WORDS[r.initiator]}</td>
                  <td className={cell}>{r.worker}</td>
                  <td className={cell}>
                    {r.shift ? (
                      <Link href={`/office/shifts/${r.shift.id}`} className="underline">
                        {shiftWords(r.shift, tz, report.thisYear)}
                      </Link>
                    ) : (
                      shiftWords(null, tz, report.thisYear)
                    )}
                    {r.moved && (
                      <span className="block text-slate-600">
                        Was {spanWords(r.moved.fromStart, r.moved.fromEnd, tz, report.thisYear)};
                        now {spanWords(r.moved.toStart, r.moved.toEnd, tz, report.thisYear)}.
                        {r.moved.siteChanged ? " The site changed." : ""}
                      </span>
                    )}
                  </td>
                  <td className={cell}>
                    {r.noticeHours === null ? "Not recorded" : noticeWords(r.noticeHours)}
                    {r.noticeFromCurrentStart ? " (from the current start)" : ""}
                  </td>
                  <td className={cell}>{r.shortNotice ? "Yes" : "No"}</td>
                  <td className={cell}>{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-8">
        <Link href="/office" className="underline">
          Back to Today
        </Link>
      </p>
    </main>
  );
}
