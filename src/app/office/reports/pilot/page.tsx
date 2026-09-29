import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { dayWithYear } from "@/lib/office/action-log";
import { pilotRows } from "@/lib/office/pilot-copy";
import { officePilotReport, parsePilotQuery } from "@/lib/office/pilot-report";
import { timeOnDay } from "@/lib/portal/format";
import { FiguresForm, UpdateNowButton } from "./forms";

const section = "mt-8";
const heading = "text-2xl font-bold";
const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";
const field = "rounded border border-slate-400 px-2 py-1";
const cell = "border-b border-slate-200 px-2 py-2 align-top";

// The pilot metrics page (docs/screens.md `/office/reports/pilot`; docs/pilot-playbook.md): the
// week-0 baseline against the app's own figures, the forms for the baseline and the weekly tally,
// and "Update the figures now". Admins and resourcers.
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
    <main className="mx-auto max-w-5xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Pilot metrics</h1>
      <p className="mt-2">The week-0 baseline against the app&apos;s own figures.</p>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="pilot-from" className="font-semibold">
            From
          </label>
          <input id="pilot-from" type="date" name="from" defaultValue={f.from} className={field} />
        </div>
        <div className="flex flex-col">
          <label htmlFor="pilot-to" className="font-semibold">
            To
          </label>
          <input id="pilot-to" type="date" name="to" defaultValue={f.to} className={field} />
        </div>
        <button type="submit" className={button}>
          Show
        </button>
      </form>

      <p className="mt-4">
        {dayWithYear(f.from, year)} to {dayWithYear(f.to, year)} ({report.days}{" "}
        {report.days === 1 ? "day" : "days"}).{report.clamped ? " At most 92 days at a time." : ""}
      </p>
      <p className="mt-1">
        {report.daily.updatedAt
          ? `Daily figures last worked out at ${timeOnDay(report.daily.updatedAt, tz)}. They're worked out again each night at 00:30.`
          : "No daily figures for these dates yet. They're worked out each night at 00:30."}
      </p>
      <UpdateNowButton />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr>
              <th className={cell}>Measure</th>
              <th className={cell}>Baseline</th>
              <th className={cell}>Now</th>
              <th className={cell}>Target by week 4</th>
            </tr>
          </thead>
          <tbody>
            {pilotRows(report).map((row) => (
              <tr key={row.label}>
                <td className={cell}>{row.label}</td>
                <td className={cell}>{row.baseline}</td>
                <td className={cell}>{row.now}</td>
                <td className={cell}>{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className={section} aria-labelledby="baseline">
        <h2 id="baseline" className={heading}>
          Baseline (week 0)
        </h2>
        <p className="mt-2">
          Count these for one normal week before go-live. A blank figure keeps what&apos;s there.
        </p>
        {report.baseline.updatedAt && (
          <p className="mt-1 text-base text-slate-600">
            Last saved at {timeOnDay(report.baseline.updatedAt, tz)}.
          </p>
        )}
        <FiguresForm
          kind="baseline"
          week={report.baseline.weekStart ?? report.tally.thisWeek}
          current={report.baseline.values}
        />
      </section>

      <section className={section} aria-labelledby="tally">
        <h2 id="tally" className={heading}>
          This week&apos;s tally
        </h2>
        <p className="mt-2">
          What the app can&apos;t see: count them each week of the pilot. A blank figure keeps
          what&apos;s there.
        </p>
        <FiguresForm
          kind="tally"
          week={report.tally.thisWeek}
          current={report.tally.thisWeekValues}
        />
      </section>

      <p className="mt-8">
        <Link href="/office" className="underline">
          Back to Today
        </Link>
      </p>
    </main>
  );
}
