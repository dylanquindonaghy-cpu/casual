import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  field,
  h2,
  headingGap,
  label,
  meta,
  page,
  sectionGap,
  table,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { dayWithYear } from "@/lib/office/action-log";
import { pilotRows } from "@/lib/office/pilot-copy";
import { officePilotReport, parsePilotQuery } from "@/lib/office/pilot-report";
import { timeOnDay } from "@/lib/portal/format";
import { FiguresForm, UpdateNowButton } from "./forms";

export const metadata: Metadata = { title: "Pilot metrics" };

// A figure column: right aligned, digits the same width so they line up.
const num = `${table.td} ${table.num}`;
const numHead = `${table.th} ${table.num} whitespace-nowrap`;
// One field of the filter bar, its label above it.
const filter = "flex flex-col gap-1";

// The pilot metrics page (docs/screens.md `/office/reports/pilot`; docs/pilot-playbook.md): the
// week-0 baseline against the app's own figures, the forms for the baseline and the weekly tally,
// and "Update the figures now". Admins and resourcers.
// Layout (docs/ui-design.md "Report table"): the dates as a filter bar, when the figures were
// worked out with "Update the figures now", the table (the measure is each row's first cell, a
// <td>), then the two forms, each in a card. One sky main button (Phase 23): "Save this week's
// tally", the weekly job; "Show" and the baseline's save (once, before go-live) are plain.
export default async function PilotMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm } = await requireOfficeArea("pilot");
  const report = await officePilotReport(
    { firm },
    (await readSessionToken("office")) ?? "",
    parsePilotQuery(await searchParams),
  );
  if (!report) notFound();
  const f = report.filters;
  const tz = report.timeZone;
  const year = f.to.slice(0, 4);
  return (
    <main className={page.office}>
      <PageHeader title="Pilot metrics">
        <p>The week-0 baseline against the app&apos;s own figures.</p>
      </PageHeader>

      <form
        method="get"
        className={`${card} grid grid-cols-2 items-end gap-4 sm:flex sm:flex-wrap`}
      >
        <div className={filter}>
          <label htmlFor="pilot-from" className={label}>
            From
          </label>
          <input
            id="pilot-from"
            type="date"
            name="from"
            defaultValue={f.from}
            className={`${field} w-full sm:w-44`}
          />
        </div>
        <div className={filter}>
          <label htmlFor="pilot-to" className={label}>
            To
          </label>
          <input
            id="pilot-to"
            type="date"
            name="to"
            defaultValue={f.to}
            className={`${field} w-full sm:w-44`}
          />
        </div>
        <button type="submit" className={`${btn.secondary} col-span-2`}>
          Show
        </button>
      </form>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-prose flex-col gap-1">
          <p className="font-semibold tabular-nums">
            {dayWithYear(f.from, year)} to {dayWithYear(f.to, year)} ({report.days}{" "}
            {report.days === 1 ? "day" : "days"}).
            {report.clamped ? " At most 92 days at a time." : ""}
          </p>
          <p className={meta}>
            {report.daily.updatedAt
              ? `Daily figures last worked out at ${timeOnDay(report.daily.updatedAt, tz)}. They're worked out again each night at 00:30.`
              : "No daily figures for these dates yet. They're worked out each night at 00:30."}
          </p>
        </div>
        <UpdateNowButton />
      </div>

      <div
        role="region"
        tabIndex={0}
        aria-label="Pilot metrics"
        className={`${table.wrap} ${headingGap}`}
      >
        <table className={table.table}>
          <thead>
            <tr>
              <th className={`${table.th} whitespace-nowrap`}>Measure</th>
              <th className={numHead}>Baseline</th>
              <th className={numHead}>Now</th>
              <th className={numHead}>Target by week 4</th>
            </tr>
          </thead>
          <tbody>
            {pilotRows(report).map((row) => (
              <tr key={row.label}>
                <td className={`${table.td} min-w-56 font-semibold text-ink`}>{row.label}</td>
                <td className={`${num} min-w-28`}>{row.baseline}</td>
                <td className={`${num} min-w-28`}>{row.now}</td>
                <td className={`${num} min-w-28`}>{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={sectionGap.office} aria-labelledby="baseline">
        <h2 id="baseline" className={h2}>
          Baseline (week 0)
        </h2>
        <div className={`${card} ${headingGap}`}>
          <p className="max-w-prose">
            Count these for one normal week before go-live. A blank figure keeps what&apos;s there.
          </p>
          {report.baseline.updatedAt && (
            <p className={`mt-1 ${meta}`}>
              Last saved at {timeOnDay(report.baseline.updatedAt, tz)}.
            </p>
          )}
          <FiguresForm
            kind="baseline"
            week={report.baseline.weekStart ?? report.tally.thisWeek}
            current={report.baseline.values}
          />
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="tally">
        <h2 id="tally" className={h2}>
          This week&apos;s tally
        </h2>
        <div className={`${card} ${headingGap}`}>
          <p className="max-w-prose">
            What the app can&apos;t see: count them each week of the pilot. A blank figure keeps
            what&apos;s there.
          </p>
          <FiguresForm
            kind="tally"
            week={report.tally.thisWeek}
            current={report.tally.thisWeekValues}
          />
        </div>
      </section>

      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}
