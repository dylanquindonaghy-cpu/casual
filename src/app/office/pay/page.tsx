import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  count,
  h2,
  headingGap,
  meta,
  page,
  rows,
  row,
  sectionGap,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officePayDashboard, type PayDashboard } from "@/lib/office/pay-dashboard";
import { digestLines } from "@/lib/office/pay-digest-copy";
import { timeOnDay } from "@/lib/portal/format";
import { payDayFallbackText, payPeriodLabel } from "@/lib/pay/pay-week";
import { ISSUE_LABELS } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";
import { firmShiftsLine, shiftsLineText } from "@/lib/tenancy/shifts-line";
import { SendDigestButton } from "../pay-queries/send-digest-button";

export const metadata: Metadata = { title: "Pay dashboard" };

// Payroll's home (docs/office-v2.md 3.8; docs/screens.md `/office/pay`); `/office` sends payroll
// here. Admins and payroll. The firm's shifts line under the title (as on `/office`), the four
// counts, the waiting queries grouped by likely cause (each opening Pay queries) and what was
// sorted in the last 7 days. No AI answers a pay question, and no pay figure is shown here.

const tile = `${card} flex flex-col gap-1`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Counts({ d }: { d: PayDashboard }) {
  const tz = d.timeZone;
  const [, lastLine, ...problems] = digestLines(d.digest.schedule, d.digest.status, tz);
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className={tile}>
        <p className="font-stat text-3xl text-ink">{d.waiting.count}</p>
        <p className="font-semibold text-ink">Pay queries waiting</p>
        <p className={meta}>
          {d.waiting.oldest ? `Oldest: ${timeOnDay(d.waiting.oldest, tz)}.` : "None waiting."}
        </p>
      </div>
      <div className={tile}>
        <p className="text-2xl font-semibold tracking-heading text-ink">
          {d.digest.next ? timeOnDay(d.digest.next, tz) : "None scheduled"}
        </p>
        <p className="font-semibold text-ink">Next digest</p>
        <p className={meta}>{lastLine}</p>
        {problems.map((line) => (
          <p key={line} className="text-sm font-semibold text-urgent-ink">
            {line}
          </p>
        ))}
      </div>
      <div className={tile}>
        <p className="font-stat text-3xl text-ink">{d.sortedThisWeek}</p>
        <p className="font-semibold text-ink">Sorted this {d.period.label}</p>
        <p className={meta}>Since {dayLabel(d.weekStart)}.</p>
      </div>
      <div className={tile}>
        <p className="text-2xl font-semibold tracking-heading text-ink">
          {dayLabel(d.nextPayDate)}
        </p>
        <p className="font-semibold text-ink">Next pay date</p>
        <p className={meta}>
          {d.nextPayDateFrom === "pay records"
            ? "From your pay records."
            : payDayFallbackText(d.period)}
        </p>
      </div>
    </div>
  );
}

export default async function PayDashboardPage() {
  const { firm } = await requireOfficeArea("pay");
  const token = (await readSessionToken("office")) ?? "";
  const d = await officePayDashboard({ firm }, token);
  if (!d) notFound();
  const tz = d.timeZone;
  return (
    <main className={page.office}>
      <PageHeader
        title="Pay dashboard"
        actions={
          <>
            <Link href="/office/pay/import" className={btn.secondary}>
              Import pay records
            </Link>
            <SendDigestButton />
          </>
        }
      >
        {/* The firm's pay week or cycle (Phase 25.2), from the top bar (Phase 24). */}
        <p className={`${meta} tabular-nums`}>{payPeriodLabel(d.period)}</p>
        <p className={meta}>{shiftsLineText(await firmShiftsLine({ firm }))}</p>
      </PageHeader>

      <Counts d={d} />

      <section className={sectionGap.office} aria-labelledby="waiting-heading">
        <div className="flex items-center">
          <h2 id="waiting-heading" className={h2}>
            Waiting, grouped by likely cause
          </h2>
          {d.waiting.count > 0 ? <span className={count}>{d.waiting.count}</span> : null}
        </div>
        <p className={`${headingGap} text-ink-muted`}>
          Pay questions never get an AI answer: they come here.
        </p>
        {d.groups.length === 0 ? (
          <p className={`${card} mt-3 text-ink-muted`}>No pay queries waiting.</p>
        ) : (
          <ul role="list" className={`${rows} mt-3`}>
            {d.groups.map((g) => (
              <li key={g.key} className={row}>
                <Link
                  href="/office/pay-queries"
                  className="font-semibold underline underline-offset-4"
                >
                  {g.heading}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {d.moreGroups > 0 ? (
          <p className={`${meta} mt-2`}>
            {plural(d.moreGroups, "more group", "more groups")} on Pay queries.
          </p>
        ) : null}
      </section>

      <section className={sectionGap.office} aria-labelledby="sorted-heading">
        <h2 id="sorted-heading" className={h2}>
          Recently sorted
        </h2>
        <p className={`${headingGap} text-ink-muted`}>The last 7 days.</p>
        {d.recentlySorted.length === 0 ? (
          <p className={`${card} mt-3 text-ink-muted`}>Nothing sorted in the last 7 days.</p>
        ) : (
          <ul role="list" className={`${rows} mt-3`}>
            {d.recentlySorted.map((s) => (
              <li
                key={`${s.at.toISOString()}-${s.by ?? ""}`}
                className={`${row} flex flex-col gap-1`}
              >
                <p className="font-semibold text-ink">
                  {plural(s.count, "query", "queries")}: {ISSUE_LABELS[s.issue].toLowerCase()}, the{" "}
                  {d.period.label} of {dayLabel(s.periodStart)}
                </p>
                <p className={meta}>
                  Sorted by {s.by ?? "someone no longer in the office team"} at{" "}
                  {timeOnDay(s.at, tz)}.
                </p>
                {s.note ? (
                  <p className="whitespace-pre-line text-ink">&ldquo;{s.note}&rdquo;</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
