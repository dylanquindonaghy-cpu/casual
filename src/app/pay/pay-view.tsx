import Link from "next/link";
import type { ReactNode } from "react";
import {
  headingGap,
  muted,
  nums,
  sectionGap,
  staffBtn,
  staffCard,
  staffRow,
  staffH2,
  staffRows,
} from "@/app/ui/classes";
import { DateTile } from "@/app/ui/sign";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { possessive } from "@/lib/portal/copy";
import { payDayRowText } from "@/lib/portal/home-copy";
import type { MyPayDay } from "@/lib/portal/pay-day";
import { hoursText, payWeeks, pounds, type PayLine, type PayWeek } from "@/lib/portal/pay-format";
import { ISSUE_LABELS, PAY_QUERY_STATUS_WORDS, type PayIssue } from "@/lib/portal/pay-query-kinds";
import { datePartsOfDay } from "@/lib/portal/sign-copy";
import { dayLabel } from "@/lib/rules/reasons";
import { PayAnswersSeen } from "./pay-answers-seen";

// The pay day, first on Pay, before the code (Phase 28.10; docs/screens.md "### 28.10"): the same
// day and words as Home's pay row (src/lib/portal/pay-day.ts, home-copy.ts payDayRowText): the
// next pay day not yet past, as the office's (Phase 37.1), and when this period is paid later, that
// day. A day and dates only: no hours, rate or amount, which stay behind the code (golden rule 9).
export function PayDayCard({ pay }: { pay: MyPayDay }) {
  const text = payDayRowText(pay.payDay, pay);
  const day = datePartsOfDay(pay.payDay);
  return (
    <section
      aria-labelledby="pay-day"
      data-pay-day={pay.payDay}
      className={`${staffCard} flex items-center gap-3.5`}
    >
      <DateTile dow={day.dow} day={day.day} />
      <div className="min-w-0 flex-1">
        <h2 id="pay-day" className={staffH2}>
          {text.title}
        </h2>
        <p className={muted}>{text.sub}</p>
        {text.note && <p className={muted}>{text.note}</p>}
      </div>
    </section>
  );
}

// The pay page once the code has been checked (docs/screens.md, `/pay`; Phases 17, 24 and 28): the
// last 8 weeks of pay lines as payroll sent them, a week at a time (newest first: src/lib/portal/pay.ts).
// Under the line saying so, the pay day card (`payDay`, Phase 28.10), then the newest week as a
// card 32px below (12px round, 16px inside, no lighter band: Phase 28): its dates as a heading,
// "Pay before tax" and its total, a tile per rate, the pay date on a clear glass tile. Then "Earlier
// weeks", one row a week (its dates and lines, its total and pay date on the right). A week's total
// shows only when payroll gave a gross for every line of it (payWeeks: src/lib/portal/pay-format.ts);
// otherwise each line shows payroll's own gross, and a line it gave none for shows none. Nothing
// else is worked out.
export function PayView({
  lines,
  firmName,
  payDay,
}: {
  lines: PayLine[];
  firmName: string;
  payDay?: ReactNode;
}) {
  const [latest, ...earlier] = payWeeks(lines);
  if (!latest) {
    return (
      <>
        {payDay}
        <p className={payDay ? sectionGap.staff : undefined}>
          No pay to show yet. It appears here once payroll sends it.
        </p>
      </>
    );
  }
  return (
    <>
      <p className={`-mt-4 ${muted}`}>The last 8 weeks, from {possessive(firmName)} payroll.</p>
      {payDay && <div className="mt-4">{payDay}</div>}
      <section
        aria-labelledby="latest-pay"
        data-pay-week={latest.periodStart}
        className={`${sectionGap.staff} glass flex flex-col gap-3 rounded-inner p-4 ${nums}`}
      >
        <h2 id="latest-pay" className={staffH2}>
          {weekDates(latest)}
        </h2>
        {latest.totalPence !== null && (
          <p className="flex flex-col">
            {/* Seen, not read out: the amount below carries "Pay before tax: " for screen readers. */}
            <span aria-hidden="true" className="text-base text-ink-muted">
              Pay before tax
            </span>
            <span data-pay-total="" className="font-stat text-4xl text-ink">
              <span className="sr-only">Pay before tax: </span>
              {pounds(latest.totalPence)}
            </span>
          </p>
        )}
        <ul role="list" className="flex flex-col gap-2">
          {latest.lines.map((line) => (
            <li
              key={line.ratePence}
              data-pay-line=""
              className="glass-tile flex flex-col gap-0.5 rounded-row px-4 py-3 text-lg"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-ink">{hoursText(line.hours)}</span>{" "}
                <span className="text-ink">at {pounds(line.ratePence)} an hour</span>
              </span>{" "}
              {latest.totalPence === null && line.grossPence !== null && (
                <span className="font-semibold text-ink">
                  Pay before tax: {pounds(line.grossPence)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {latest.payDates.length > 0 && (
          <p className="glass-tile w-fit rounded-row px-3 py-1.5 text-lg text-ink">
            {payDateText(latest.payDates)}
          </p>
        )}
      </section>
      {earlier.length > 0 && (
        <section
          aria-labelledby="earlier-pay"
          className={`${sectionGap.staff} flex flex-col gap-3`}
        >
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
                      <span className="sr-only">Pay before tax: </span>
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
                            <span className="sr-only">Pay before tax: </span>
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
      <p className={`${sectionGap.staff} text-base`}>
        If something looks wrong, raise a pay query.
      </p>
    </>
  );
}

// "Mon 19 Oct to Sun 25 Oct".
const weekDates = (week: PayWeek) => `${dayLabel(week.periodStart)} to ${dayLabel(week.periodEnd)}`;

// "Pay day: Fri 30 Oct"; a week paid on two days names both.
const payDateText = (days: string[]) =>
  days.length === 1
    ? `Pay day: ${dayLabel(days[0]!)}`
    : `Pay days: ${days.slice(0, -1).map(dayLabel).join(", ")} and ${dayLabel(days.at(-1)!)}`;

// "With payroll" is waiting on payroll; "Answered by payroll" is done (docs/ui-design.md "Status tones").
const TONES: Record<string, StatusTone> = {
  open: "attention",
  in_digest: "attention",
  resolved: "done",
};

type ShownQuery = {
  ref: string;
  issue: PayIssue;
  day: string;
  status: string;
  sortedOn?: string | null; // absent for one sorted without a date (none are, since Phase 6)
  note?: string | null;
  // Phase 28.10: an answer she hasn't seen yet (myPayQueries), and when payroll sorted it.
  unseen?: boolean;
  resolvedAt?: Date | string | null;
};

const isoOf = (at: Date | string | null | undefined): string | null => {
  if (at === null || at === undefined) return null;
  const ms = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// "Raise a pay query", and the worker's own pay queries from the last 90 days with their status:
// once payroll has sorted one, the day and payroll's note (a person's words).
// Phase 28.10: with answers she hasn't seen (`newAnswers`), every one of them (`unseen`, with when
// it was sorted) is marked for PayAnswersSeen, which wraps the list and marks them seen as far as
// every unseen answer up to then has been on her screen (`shownAt`: when the page was drawn), so
// the Pay tab's count goes. An answer she has already seen is never watched in its place: the list
// is newest query first, not in the order payroll answered.
export function PayQueries({
  queries,
  newAnswers = false,
  shownAt,
}: {
  queries: ShownQuery[];
  newAnswers?: boolean;
  shownAt?: string;
}) {
  const watched = (q: ShownQuery): string | null =>
    newAnswers && shownAt && q.status === "resolved" && q.unseen === true
      ? isoOf(q.resolvedAt)
      : null;
  const watching = queries.some((q) => watched(q) !== null);
  const list = (
    <ul role="list" className={`${staffRows} ${headingGap}`}>
      {queries.map((q) => {
        const row = <QueryRow q={q} />;
        const sortedAt = watched(q);
        return (
          <li key={q.ref} className={staffRow}>
            {sortedAt ? (
              <div data-pay-answer="" data-resolved-at={sortedAt}>
                {row}
              </div>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
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
      ) : watching && shownAt ? (
        <PayAnswersSeen shownAt={shownAt}>{list}</PayAnswersSeen>
      ) : (
        list
      )}
    </section>
  );
}

function QueryRow({ q }: { q: ShownQuery }) {
  return (
    <>
      <StatusChip tone={q.sortedOn ? "done" : (TONES[q.status] ?? "quiet")}>
        {q.sortedOn
          ? `Answered by payroll on ${dayLabel(q.sortedOn)}`
          : (PAY_QUERY_STATUS_WORDS[q.status] ?? q.status)}
      </StatusChip>
      <p className="mt-2 font-semibold">
        {ISSUE_LABELS[q.issue]}: {dayLabel(q.day)}
      </p>
      {q.note && <p className="mt-2">Payroll says: &ldquo;{q.note}&rdquo;</p>}
      <p className={`mt-2 ${muted} ${nums}`}>Reference {q.ref}</p>
    </>
  );
}
