import Link from "next/link";
import { h2, headingGap, muted, nums, row, rows, sectionGap, staffBtn } from "@/app/ui/classes";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { hoursText, pounds, type PayLine } from "@/lib/portal/pay-format";
import { ISSUE_LABELS, PAY_QUERY_STATUS_WORDS, type PayIssue } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";

// The pay page once the code has been checked (docs/screens.md, `/pay`): the last 8 weeks of pay
// lines as payroll sent them, one row each. Only what the payroll file had: a gross that wasn't
// in it isn't worked out here.
export function PayView({ lines, firmName }: { lines: PayLine[]; firmName: string }) {
  if (lines.length === 0) {
    return <p>No pay data yet for this period.</p>;
  }
  return (
    <>
      <p className={muted}>The last 8 weeks, from {firmName}&apos;s payroll.</p>
      <ul role="list" className={`${rows} ${headingGap} ${nums}`}>
        {lines.map((line) => (
          <li key={`${line.periodStart}:${line.periodEnd}:${line.ratePence}`} className={row}>
            <p className="font-semibold">
              {dayLabel(line.periodStart)} to {dayLabel(line.periodEnd)}
            </p>
            <p className="mt-1">
              {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
            </p>
            {line.grossPence !== null && (
              <p className="mt-1 text-2xl font-bold">Gross pay: {pounds(line.grossPence)}</p>
            )}
            {line.payDate && <p className="mt-1 text-base">Pay date: {dayLabel(line.payDate)}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-6">If something looks wrong, raise a pay query.</p>
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
