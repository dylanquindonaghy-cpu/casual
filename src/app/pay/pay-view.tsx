import Link from "next/link";
import { hoursText, pounds, type PayLine } from "@/lib/portal/pay-format";
import { ISSUE_LABELS, PAY_QUERY_STATUS_WORDS, type PayIssue } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";

// The pay page once the code has been checked (docs/screens.md, `/pay`): the last 8 weeks of pay
// lines as payroll sent them. Only what the payroll file had: a gross that wasn't in it isn't
// worked out here.
export function PayView({ lines, firmName }: { lines: PayLine[]; firmName: string }) {
  if (lines.length === 0) {
    return <p className="mt-6">No pay data yet for this period.</p>;
  }
  return (
    <>
      <p className="mt-4 text-base text-slate-600">
        The last 8 weeks, from {firmName}&apos;s payroll.
      </p>
      <ul className="mt-4 space-y-4">
        {lines.map((line) => (
          <li
            key={`${line.periodStart}:${line.periodEnd}:${line.ratePence}`}
            className="rounded-2xl border-2 border-slate-300 p-4"
          >
            <p className="font-semibold">
              {dayLabel(line.periodStart)} to {dayLabel(line.periodEnd)}
            </p>
            <p className="mt-1 text-xl">
              {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
            </p>
            {line.grossPence !== null && (
              <p className="mt-1">Gross pay: {pounds(line.grossPence)}</p>
            )}
            {line.payDate && <p className="mt-1">Pay date: {dayLabel(line.payDate)}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-base">If something looks wrong, raise a pay query.</p>
    </>
  );
}

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
    <section className="mt-6" aria-labelledby="pay-queries">
      <Link
        href="/pay/query"
        className="block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
      >
        Raise a pay query
      </Link>
      <h2 id="pay-queries" className="mt-6 text-xl font-bold">
        Your pay queries
      </h2>
      {queries.length === 0 ? (
        <p className="mt-2">None in the last 90 days.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {queries.map((q) => (
            <li key={q.ref} className="py-3">
              <p className="font-semibold">
                {ISSUE_LABELS[q.issue]}: {dayLabel(q.day)}
              </p>
              <p>
                {q.sortedOn
                  ? `Sorted on ${dayLabel(q.sortedOn)}`
                  : (PAY_QUERY_STATUS_WORDS[q.status] ?? q.status)}
              </p>
              {q.note && <p>Payroll says: &ldquo;{q.note}&rdquo;</p>}
              <p className="text-base text-slate-600">Reference {q.ref}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
