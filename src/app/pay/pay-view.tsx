import Link from "next/link";
import {
  headingGap,
  muted,
  nums,
  sectionGap,
  staffBtn,
  staffRow,
  staffH2,
  staffRows,
} from "@/app/ui/classes";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { possessive } from "@/lib/portal/copy";
import { hoursText, payWeeks, pounds, type PayLine, type PayWeek } from "@/lib/portal/pay-format";
import { ISSUE_LABELS, PAY_QUERY_STATUS_WORDS, type PayIssue } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";

// The pay page once the code has been checked (docs/screens.md, `/pay`; Phases 17 and 24): the last
// 8 weeks of pay lines as payroll sent them, a week at a time (newest first: src/lib/portal/pay.ts).
// As round 7 of the canvas has it (24.6): the newest week as a glass card (its dates, "Gross pay"
// and its total, a glass row per rate, the pay date on a warm chip), then "Earlier weeks", one row
// a week (its dates and lines, its total and pay date on the right). A week's total shows only when
// payroll gave a gross for every line of it (payWeeks: src/lib/portal/pay-format.ts); otherwise each
// line shows payroll's own gross, and a line it gave none for shows none. Nothing else is worked out.
export function PayView({ lines, firmName }: { lines: PayLine[]; firmName: string }) {
  const [latest, ...earlier] = payWeeks(lines);
  if (!latest) {
    return <p>No pay data yet for this period.</p>;
  }
  return (
    <>
      <p className={`-mt-4 ${muted}`}>The last 8 weeks, from {possessive(firmName)} payroll.</p>
      <section
        aria-labelledby="latest-pay"
        data-pay-week={latest.periodStart}
        className={`mt-5 glass flex flex-col gap-3 rounded-3xl p-5 ${nums}`}
      >
        <h2 id="latest-pay" className="text-lg font-medium text-ink">
          {weekDates(latest)}
        </h2>
        {latest.totalPence !== null && (
          <p className="flex flex-col">
            {/* Seen, not read out: the amount below carries "Gross pay: " for screen readers. */}
            <span aria-hidden="true" className="text-base text-ink-muted">
              Gross pay
            </span>
            <span data-pay-total="" className="font-stat text-4xl text-ink">
              <span className="sr-only">Gross pay: </span>
              {pounds(latest.totalPence)}
            </span>
          </p>
        )}
        <ul role="list" className="flex flex-col gap-2">
          {latest.lines.map((line) => (
            <li
              key={line.ratePence}
              data-pay-line=""
              className="glass-tile flex flex-col gap-0.5 rounded-2xl px-4 py-3 text-lg"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-ink">{hoursText(line.hours)}</span>{" "}
                <span className="text-ink">at {pounds(line.ratePence)} an hour</span>
              </span>{" "}
              {latest.totalPence === null && line.grossPence !== null && (
                <span className="font-semibold text-ink">Gross pay: {pounds(line.grossPence)}</span>
              )}
            </li>
          ))}
        </ul>
        {latest.payDates.length > 0 && (
          <p className="glass-band glass-rim w-fit rounded-[10px] px-3 py-1.5 text-lg text-ink">
            {payDateText(latest.payDates)}
          </p>
        )}
      </section>
      {earlier.length > 0 && (
        <section aria-labelledby="earlier-pay" className="mt-8 flex flex-col gap-3">
          <h2 id="earlier-pay" className={staffH2}>
            Earlier weeks
          </h2>
          <ul role="list" className={`${staffRows} overflow-hidden ${nums}`}>
            {earlier.map((week) => (
              <li
                key={`${week.periodStart}:${week.periodEnd}`}
                data-pay-week={week.periodStart}
                className="flex flex-col gap-0.5 px-4 py-3.5"
              >
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-lg font-medium text-ink">{weekDates(week)}</span>{" "}
                  {week.totalPence !== null && (
                    <span data-pay-total="" className="shrink-0 text-lg font-semibold text-ink">
                      <span className="sr-only">Gross pay: </span>
                      {pounds(week.totalPence)}
                    </span>
                  )}
                </p>
                {/* The pay date at the right of the first line while it fits (under it when it
                    doesn't); with no total, the lines' grosses hold the right, so it goes under. */}
                {week.lines.map((line, i) => (
                  <p
                    key={line.ratePence}
                    data-pay-line=""
                    className="flex flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <span className={muted}>
                      {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
                    </span>{" "}
                    {week.totalPence === null
                      ? line.grossPence !== null && (
                          <span className="ml-auto text-base font-semibold text-ink">
                            <span className="sr-only">Gross pay: </span>
                            {pounds(line.grossPence)}
                          </span>
                        )
                      : i === 0 &&
                        week.payDates.length > 0 && (
                          <span className={`ml-auto ${muted}`}>{payDateText(week.payDates)}</span>
                        )}
                  </p>
                ))}
                {week.totalPence === null && week.payDates.length > 0 && (
                  <p className={`text-right ${muted}`}>{payDateText(week.payDates)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-8 text-base">If something looks wrong, raise a pay query.</p>
    </>
  );
}

// "Mon 19 Oct to Sun 25 Oct".
const weekDates = (week: PayWeek) => `${dayLabel(week.periodStart)} to ${dayLabel(week.periodEnd)}`;

// "Pay date: Fri 30 Oct"; a week paid on two days names both.
const payDateText = (days: string[]) =>
  days.length === 1
    ? `Pay date: ${dayLabel(days[0]!)}`
    : `Pay dates: ${days.slice(0, -1).map(dayLabel).join(", ")} and ${dayLabel(days.at(-1)!)}`;

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
      <h2 id="pay-queries" className={`${sectionGap.staff} ${staffH2}`}>
        Your pay queries
      </h2>
      {queries.length === 0 ? (
        <p className={headingGap}>None in the last 90 days.</p>
      ) : (
        <ul role="list" className={`${staffRows} ${headingGap}`}>
          {queries.map((q) => (
            <li key={q.ref} className={staffRow}>
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
