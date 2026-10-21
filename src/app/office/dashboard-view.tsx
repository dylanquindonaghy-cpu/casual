import Link from "next/link";
import type { Dashboard } from "@/lib/office/dashboard";
import { SECTION_ERROR, SECTIONS } from "@/lib/office/dashboard-copy";
import {
  afterRows,
  focusItems,
  headline,
  sortedRows,
  subline,
  thingsCount,
  weekCells,
  type Row,
  type WeekCell,
} from "@/lib/office/dashboard-home";
import { meta } from "../ui/classes";
import { Icon, type IconName } from "../ui/icons";
import { Plate } from "../ui/plate";
import { FocusCard } from "./focus-card";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; Phase 18's redesign),
// one question: "what needs me now, and where do I start?". The headline says how many things need
// you (the page's heading), with the firm's shifts line under it; this week as seven days (how full
// each is, its urgent gaps or sessions to mark); then "Next up", one urgent place at a time with
// its seats and actions, and beside it (below it on narrower screens) "After that" (the rest of
// what needs you, each a row to where it's dealt with: Needs attention's page, uploads,
// enquiries), "Waiting on others" (pay queries with payroll) and "Sorted today" (cancellations,
// recorded automatically; enquiries answered; what casuals can see). Pure: the page loads the data
// (src/lib/office/dashboard-home.ts works out what it says).

const WEEK_NOTE: Record<WeekCell["note"]["kind"], string> = {
  urgent: "",
  mark: "",
  open: "text-ink",
  filled: "font-semibold text-done",
  short: "text-ink-muted",
  none: "text-ink-muted",
};

function Week({ cells }: { cells: WeekCell[] }) {
  return (
    <nav aria-label="This week">
      <ul
        role="list"
        className="grid grid-cols-7 divide-x divide-line overflow-hidden rounded-xl border border-line"
      >
        {cells.map((c) => (
          <li key={c.date} className="min-w-0">
            <Link
              href={c.href}
              aria-label={c.label}
              className={`flex h-full flex-col gap-2 px-3 pt-2.5 pb-3 hover:bg-quiet-soft focus-visible:-outline-offset-2 ${
                c.note.kind === "urgent" ? "bg-urgent-soft" : ""
              } ${c.dow === "Today" ? "border-t-[3px] border-t-ink" : ""}`}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="font-sign text-3xl leading-none">{c.day}</span>
                <span className="text-ink-muted">{c.dow}</span>
              </span>
              <span
                aria-hidden="true"
                className="flex h-1.5 overflow-hidden rounded-[1px] bg-raised"
              >
                <span
                  className="h-full bg-ink"
                  style={{ width: `${Math.round(c.filledShare * 100)}%` }}
                />
              </span>
              <span className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {c.note.kind === "urgent" ? (
                  <>
                    <Plate tone="urgent">{c.note.text}</Plate>
                    {c.note.extra && <span className="whitespace-nowrap">{c.note.extra}</span>}
                  </>
                ) : c.note.kind === "mark" ? (
                  <Plate tone="hivis">{c.note.text}</Plate>
                ) : (
                  <span className={WEEK_NOTE[c.note.kind]}>{c.note.text}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const ROW_ICON: Record<string, IconName> = {
  "to-check": "workers",
  "from-sheet": "import",
  "to-mark": "check",
  expired: "notice",
  uploads: "import",
  evidence: "strike",
  "planner-refused": "plug",
  webhook: "plug",
  enquiries: "requests",
  payQueries: "clock",
  cancellations: "cancel",
  showing: "eye",
};

function Rows({
  rows,
  tone,
  label,
}: {
  rows: Row[];
  tone: "needs" | "waiting" | "sorted";
  label: string;
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-xl border border-line"
    >
      {rows.map((r) => (
        <li key={r.key}>
          <Link
            href={r.href}
            className={`flex gap-3 px-3.5 py-3 hover:bg-quiet-soft focus-visible:-outline-offset-2 ${
              tone === "sorted" ? "items-start" : "items-center"
            }`}
          >
            {tone === "sorted" ? (
              <Icon name="check" size={20} className="mt-0.5 text-done" />
            ) : (
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                  tone === "needs" ? "bg-hivis text-on-hivis" : "bg-raised text-ink-muted"
                }`}
              >
                <Icon name={ROW_ICON[r.key] ?? "check"} size={18} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.title}</span>
              <span className="block text-sm text-ink-muted">{r.sub}</span>
            </span>
            {r.count !== null && (
              <span
                className={`font-sign text-2xl ${tone === "waiting" ? "text-ink-muted" : "text-ink"}`}
              >
                {r.count}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardContent({
  d,
  shiftsLine,
  payQueriesWaiting = 0,
}: {
  d: Dashboard;
  shiftsLine?: string;
  payQueriesWaiting?: number;
}) {
  const focus = focusItems(d);
  const needs = d.needs.ok ? d.needs.data : null;
  const needPerson = d.counts.enquiries.ok ? d.counts.enquiries.data.needPerson : 0;
  const after = afterRows(needs, needPerson, d.timeZone);
  const things = thingsCount(focus.length, after.length);
  const cells = d.week.ok ? weekCells(d.week.data, needs?.toMark ?? [], d.today, d.timeZone) : null;
  const waiting: Row[] =
    payQueriesWaiting > 0
      ? [
          {
            key: "payQueries",
            title: "Pay queries",
            sub: "With payroll, nothing for you to do",
            count: String(payQueriesWaiting),
            href: "/office/pay-queries",
          },
        ]
      : [];
  // What the headline counts could all be read (each part that couldn't says so where it shows).
  const complete = d.urgent.ok && d.needs.ok && d.counts.enquiries.ok;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {headline(things, complete)}
        </h1>
        <p className="text-ink-muted">{subline(focus.length, things, complete)}</p>
        {shiftsLine && (
          <p className={`${meta} flex items-center gap-1.5`}>
            <Icon name="phone" size={16} />
            {shiftsLine}
          </p>
        )}
      </header>
      {cells ? (
        <Week cells={cells} />
      ) : (
        <p role="status" className={meta}>
          {SECTION_ERROR}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-labelledby="next-up"
          className="flex min-w-0 flex-[1.6_1_30rem] flex-col gap-2.5"
        >
          <h2 id="next-up" className="text-lg font-semibold">
            Next up
          </h2>
          {!d.urgent.ok ? (
            <p
              role="status"
              className="rounded-xl bg-attention-soft px-3.5 py-3 text-attention-ink"
            >
              {SECTION_ERROR}
            </p>
          ) : focus.length > 0 ? (
            <>
              <FocusCard items={focus} />
              <p className={meta}>
                <Link
                  href="/office/events?view=urgent"
                  className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                >
                  All urgent places on Events &amp; sessions
                </Link>
              </p>
            </>
          ) : (
            <article className="flex animate-in flex-wrap items-center gap-4.5 rounded-xl border border-line p-5">
              <span
                aria-hidden="true"
                className="flex size-13 shrink-0 items-center justify-center rounded-lg bg-done-fill text-on-done"
              >
                <Icon name="check" size={28} />
              </span>
              <div className="min-w-55 flex-1">
                <p className="text-2xl font-semibold">
                  {SECTIONS.urgent.empty.replace("shift", "place")}
                </p>
                <p className="text-ink-muted">Nobody needs finding right now.</p>
              </div>
              <Link
                href="/office/events"
                className="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-4 font-semibold hover:bg-quiet-soft"
              >
                See events
              </Link>
            </article>
          )}
        </section>
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-2.5">
          <section aria-labelledby="after-that" className="flex flex-col gap-2.5">
            <h2 id="after-that" className="text-lg font-semibold">
              After that
            </h2>
            {/* Needs attention unread: said so, with any row that could be worked out (enquiries). */}
            {!needs && (
              <p
                role="status"
                className="rounded-xl bg-attention-soft px-3.5 py-3 text-attention-ink"
              >
                {SECTION_ERROR}
              </p>
            )}
            {after.length > 0 ? (
              <Rows rows={after} tone="needs" label="After that" />
            ) : (
              needs && (
                <p className="rounded-xl border border-line px-3.5 py-3 text-ink-muted">
                  {SECTIONS.needs.empty}
                </p>
              )
            )}
          </section>
          {waiting.length > 0 && (
            <section aria-labelledby="waiting" className="mt-2.5 flex flex-col gap-2.5">
              <h2 id="waiting" className="text-base font-semibold text-ink-muted">
                Waiting on others
              </h2>
              <Rows rows={waiting} tone="waiting" label="Waiting on others" />
            </section>
          )}
          <section aria-labelledby="sorted" className="mt-2.5 flex flex-col gap-2.5">
            <h2 id="sorted" className="text-base font-semibold text-ink-muted">
              Sorted today
            </h2>
            <Rows rows={sortedRows(d)} tone="sorted" label="Sorted today" />
          </section>
        </div>
      </div>
    </div>
  );
}
