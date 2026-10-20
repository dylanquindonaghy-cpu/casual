import Link from "next/link";
import {
  h2,
  headingGap,
  meta,
  muted,
  nums,
  row,
  rows,
  sectionGap,
  staffBtn,
} from "@/app/ui/classes";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { hoursText, pounds, type PayLine } from "@/lib/portal/pay-format";
import { ISSUE_LABELS, PAY_QUERY_STATUS_WORDS, type PayIssue } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";

// The pay page once the code has been checked (docs/screens.md, `/pay`): the last 8 weeks of pay
// lines as payroll sent them (newest period first: src/lib/portal/pay.ts). The newest period first
// and largest, every line of it (a week can have a line per rate), then the earlier periods' lines
// as compact rows, the amount and pay date on the right (Phase 17: what she opens Pay to see). Only
// what the payroll file had: a gross that wasn't in it isn't worked out here.
export function PayView({ lines, firmName }: { lines: PayLine[]; firmName: string }) {
  const first = lines[0];
  if (!first) {
    return <p>No pay data yet for this period.</p>;
  }
  const samePeriod = (line: PayLine) =>
    line.periodStart === first.periodStart && line.periodEnd === first.periodEnd;
  const latest = lines.filter(samePeriod);
  const earlier = lines.filter((line) => !samePeriod(line));
  return (
    <>
      <p className={meta}>The last 8 weeks, from {firmName}&apos;s payroll.</p>
      <section
        aria-labelledby="latest-pay"
        className={`${headingGap} rounded-2xl border border-line bg-card p-4 ${nums}`}
      >
        <h2 id="latest-pay" className="text-base font-semibold">
          {dayLabel(first.periodStart)} to {dayLabel(first.periodEnd)}
        </h2>
        {latest.map((line) => (
          <div key={line.ratePence} className="mt-2 first-of-type:mt-1">
            {line.grossPence !== null && (
              <p className="flex flex-col">
                {/* Seen, not read out: the amount below carries "Gross pay: " for screen readers. */}
                <span aria-hidden="true" className="text-sm font-semibold text-ink-muted">
                  Gross pay
                </span>
                <span className="text-3xl font-bold">
                  <span className="sr-only">Gross pay: </span>
                  {pounds(line.grossPence)}
                </span>
              </p>
            )}
            <p className="mt-1 text-base">
              {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
            </p>
            {line.payDate && (
              <p className="mt-1 text-base font-semibold">Pay date: {dayLabel(line.payDate)}</p>
            )}
          </div>
        ))}
      </section>
      {earlier.length > 0 && (
        <section aria-labelledby="earlier-pay" className={sectionGap.staff}>
          <h2 id="earlier-pay" className={h2}>
            Earlier weeks
          </h2>
          <ul role="list" className={`${rows} ${headingGap} ${nums}`}>
            {earlier.map((line) => (
              <li
                key={`${line.periodStart}:${line.periodEnd}:${line.ratePence}`}
                className={`${row} flex items-start justify-between gap-3`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {dayLabel(line.periodStart)} to {dayLabel(line.periodEnd)}
                  </p>
                  <p className={muted}>
                    {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {line.grossPence !== null && (
                    <p className="font-bold">
                      <span className="sr-only">Gross pay: </span>
                      {pounds(line.grossPence)}
                    </p>
                  )}
                  {line.payDate && <p className={muted}>Pay date: {dayLabel(line.payDate)}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={`${sectionGap.staff} text-base`}>
        If something looks wrong, raise a pay query.
      </p>
    </>
  );
}

// "With payroll" is waiting on payroll; "Sorted" is done (docs/ui-design.md "Status tones").
const TONES: Record<string, StatusTone> = {
  open: "attention",
  in_digest: "attention",
  resolved: "done",
};

// "Raise a pay query", and the worker's own pay queries from the last 90 days with their status:
// once payroll has sorted one, the day and payroll's note (a person's words).
export function PayQueries({
  queries,
}: {
  queries: {
    ref: string;
    issue: PayIssue;
    day: string;
    status: string;
    sortedOn?: string | null; // absent for one sorted without a date (none are, since Phase 6)
    note?: string | null;
  }[];
}) {
  return (
    <section className="mt-3" aria-labelledby="pay-queries">
      <Link href="/pay/query" className={staffBtn.primary}>
        Raise a pay query
      </Link>
      <h2 id="pay-queries" className={`${h2} ${sectionGap.staff}`}>
        Your pay queries
      </h2>
      {queries.length === 0 ? (
        <p className={headingGap}>None in the last 90 days.</p>
      ) : (
        <ul role="list" className={`${rows} ${headingGap}`}>
          {queries.map((q) => (
            <li key={q.ref} className={row}>
              <StatusChip tone={q.sortedOn ? "done" : (TONES[q.status] ?? "quiet")}>
                {q.sortedOn
                  ? `Sorted on ${dayLabel(q.sortedOn)}`
                  : (PAY_QUERY_STATUS_WORDS[q.status] ?? q.status)}
              </StatusChip>
              <p className="mt-2 font-semibold">
                {ISSUE_LABELS[q.issue]}: {dayLabel(q.day)}
              </p>
              {q.note && <p className="mt-2">Payroll says: &ldquo;{q.note}&rdquo;</p>}
              <p className={`mt-2 ${muted} ${nums}`}>Reference {q.ref}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
