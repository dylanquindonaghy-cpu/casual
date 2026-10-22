import Link from "next/link";
import type { ReactNode } from "react";
import { attentionCount, type Dashboard } from "@/lib/office/dashboard";
import { COUNT_ERROR, SECTION_ERROR, SECTIONS } from "@/lib/office/dashboard-copy";
import {
  afterRows,
  attentionText,
  focusItems,
  greeting,
  headline,
  moreLabels,
  oneCount,
  sortedRows,
  startLine,
  urgentDaysText,
  weekCells,
  weekSummary,
  type Row,
  type WeekCell,
} from "@/lib/office/dashboard-home";
import { payWeek } from "@/lib/pay/pay-week";
import { datePartsOfDay } from "@/lib/portal/sign-copy";
import { dayLabel } from "@/lib/rules/reasons";
import { btn, meta, textLink } from "../ui/classes";
import { Icon } from "../ui/icons";
import { Plate } from "../ui/plate";
import { UrgentPlaces } from "./urgent-places";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; Phases 18 and 20),
// one question: "what needs me now, and where do I start?". A greeting with the one count of what
// needs you (the urgent places still to fill and Needs attention's items: the menu's count, so
// they add up) and where to start, with today's date, the pay week and the firm's shifts line; four
// count tiles (urgent places, needs attention, waiting on others, sorted today); then panels: every
// urgent place to fill, each with "Offer to someone" and "…" (mark as filled, not urgent); this week
// as a bar per day with the places still to fill; Needs attention, a row per kind, each to where
// it's dealt with; "Waiting on others" (pay queries with payroll) and "Sorted today"
// (cancellations, recorded automatically; enquiries answered; what casuals can see). Pure: the
// page loads the data (src/lib/office/dashboard-home.ts works out what it says).

// A count tile's colours: what it counts.
const TILE = {
  urgent: "bg-urgent-tile text-urgent-ink",
  todo: "bg-hivis text-on-hivis",
  wait: "bg-wait-tile text-wait-ink",
  done: "bg-done-tile text-done-ink",
} as const;

function CountTile({
  tone,
  label,
  value,
  caption,
  href,
}: {
  tone: keyof typeof TILE;
  label: string;
  value: string;
  caption: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-sm font-semibold">{label}</span>
      <span className="mt-auto pt-4 font-sign text-4xl leading-none font-normal">{value}</span>
      <span className="mt-1.5 text-sm">{caption}</span>
    </>
  );
  const box = `flex min-h-33 flex-col rounded-[22px] border border-current/15 px-4.5 pt-4 pb-4.5 shadow-lift ${TILE[tone]}`;
  return href ? (
    <Link href={href} className={`${box} hover:brightness-[0.97] focus-visible:outline-offset-2`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

// A panel: a tinted ground for its rows (each lifted off it), or a plain card (`card`).
const PANEL = {
  urgent: "border-urgent/15 bg-urgent-soft",
  todo: "border-attention/15 bg-attention-soft",
  wait: "border-wait-ink/15 bg-wait-tile/40",
  done: "border-done/15 bg-done-soft",
  card: "border-line bg-card shadow-panel",
} as const;

function Panel({
  id,
  title,
  tone,
  count,
  link,
  className = "",
  children,
}: {
  id: string;
  title: string;
  tone: keyof typeof PANEL;
  count?: string;
  link?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-2.5 rounded-[22px] border p-4.5 ${PANEL[tone]} ${className}`}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {count && (
          <span className="rounded-full bg-card px-2 text-sm font-semibold tabular-nums">
            {count}
          </span>
        )}
        {link && <span className="ml-auto text-sm">{link}</span>}
      </div>
      {children}
    </section>
  );
}

// A row lifted off its panel.
const LIFTED = "rounded-2xl border border-line bg-card shadow-lift";

// This week: the places still to fill as the big number, then a bar per day (today in a dark
// pill), each a link to that day (or its sessions to mark).
function Week({ cells }: { cells: WeekCell[] }) {
  const sum = weekSummary(cells);
  return (
    <>
      <p>
        <span className="font-sign text-4xl leading-none font-normal">{sum.toFill}</span>
      </p>
      <p className="-mt-1 text-sm text-ink-muted">
        {sum.toFill === 1 ? "place" : "places"} still to fill.
        {sum.days && ` ${sum.filled} of ${sum.places} filled, ${sum.days}.`}
      </p>
      <nav aria-label="This week">
        <ul role="list" className="flex flex-col gap-1.5">
          {cells.map((c) => (
            <li key={c.date}>
              <Link
                href={c.href}
                aria-label={c.label}
                className="grid min-h-7 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2 rounded-lg px-1 hover:bg-quiet-soft"
              >
                <span
                  // Today on the ink pill keeps its own text colour (red on it would fail the
                  // contrast test); the day's bar and note still say it's urgent.
                  className={`flex h-6 items-center justify-center rounded-full text-sm ${
                    c.dow === "Today"
                      ? "bg-ink font-semibold text-on-ink"
                      : c.note.kind === "urgent"
                        ? "text-urgent"
                        : "text-ink-muted"
                  }`}
                >
                  {c.dow === "Today" ? "Today" : c.dow}
                </span>
                {c.places > 0 ? (
                  <span
                    aria-hidden="true"
                    className="flex h-2.5 overflow-hidden rounded-full bg-raised"
                  >
                    <span
                      className={`h-full rounded-full ${c.past ? "bg-line-strong" : c.note.kind === "urgent" ? "bg-urgent-fill" : "bg-brand"}`}
                      style={{ width: `${Math.round(c.filledShare * 100)}%` }}
                    />
                  </span>
                ) : (
                  <span aria-hidden="true" className="h-0.5 w-3.5 bg-line" />
                )}
                <span className="text-right text-sm text-ink-muted tabular-nums">
                  {c.note.kind === "mark" ? (
                    <Plate tone="hivis">{c.note.text}</Plate>
                  ) : c.places === 0 ? (
                    "–"
                  ) : c.past ? (
                    "done"
                  ) : (
                    `${c.filled}/${c.places}`
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

const ROW_ACTION: Record<string, string> = {
  "to-check": "Check them",
  "from-sheet": "See them",
  "to-mark": "Mark who worked",
  expired: "See them",
  uploads: "Check",
  evidence: "See them",
  "planner-refused": "See them",
  webhook: "See it",
  enquiries: "Answer",
};

// Rows lifted off their panel, each a link to where it's dealt with: Needs attention's and
// waiting on others' with their count and what to do; sorted today's with a tick.
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
    <ul role="list" aria-label={label} className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key}>
          <Link
            href={r.href}
            className={`${LIFTED} group flex items-center gap-3 px-3.5 py-3 hover:bg-quiet-soft focus-visible:outline-offset-2`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.title}</span>
              <span className="block text-sm text-ink-muted">{r.sub}</span>
            </span>
            {tone === "sorted" ? (
              <Icon name="check" size={20} className="text-done" />
            ) : (
              <>
                {r.count !== null && (
                  <span className="font-sign text-lg tabular-nums">{r.count}</span>
                )}
                {tone === "needs" && (
                  <span
                    aria-hidden="true"
                    className="hidden rounded-full border border-line-strong px-3 py-1 text-sm font-semibold group-hover:bg-card sm:inline"
                  >
                    {ROW_ACTION[r.key] ?? "Open"}
                  </span>
                )}
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardContent({
  d,
  firmName,
  shiftsLine,
  payQueriesWaiting = 0,
  now,
}: {
  d: Dashboard;
  firmName: string;
  shiftsLine?: string;
  payQueriesWaiting?: number;
  now: Date;
}) {
  const focus = focusItems(d);
  const needs = d.needs.ok ? d.needs.data : null;
  const needPerson = d.counts.enquiries.ok ? d.counts.enquiries.data.needPerson : 0;
  const after = afterRows(needs, needPerson, d.timeZone);
  const attention = needs ? attentionCount(needs, needPerson) : null;
  const urgentPlaces = d.counts.urgent.ok ? d.counts.urgent.data.places : 0;
  const things = oneCount(urgentPlaces, attention?.count ?? needPerson);
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
  const sorted = sortedRows(d);
  const c = d.counts;
  const sortedCount =
    (c.cancellations.ok ? c.cancellations.data.total : 0) +
    (c.enquiries.ok ? c.enquiries.data.total : 0);
  // What the headline counts could all be read (each part that couldn't says so where it shows);
  // a list stopped at 50 is counted as "at least".
  const complete =
    d.counts.urgent.ok && d.needs.ok && d.counts.enquiries.ok && !(attention?.more ?? false);
  const week = payWeek(d.today);
  const today = datePartsOfDay(d.today);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-ink">
          <span className="block font-greet text-4xl">
            {greeting(now, d.timeZone)}, {firmName}.
          </span>{" "}
          <span className="mt-2.5 block text-lg font-semibold">{headline(things, complete)}.</span>
        </h1>
        <p className="-mt-1 text-lg text-ink-muted">
          {startLine(focus[0], things, complete, urgentPlaces)}
        </p>
        <p className={`${meta} tabular-nums`}>
          {LONG(today)} · Week {week.week} · Pay on {dayLabel(week.payDay)}
        </p>
        {shiftsLine && (
          <p className={`${meta} flex items-center gap-1.5`}>
            <Icon name="phone" size={16} />
            {shiftsLine}
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <CountTile
          tone="urgent"
          label="Urgent places"
          value={d.counts.urgent.ok ? String(urgentPlaces) : "–"}
          caption={
            !d.counts.urgent.ok
              ? COUNT_ERROR
              : urgentPlaces === 0
                ? "Every urgent place is filled"
                : urgentDaysText(focus)
          }
          href="/office/events?view=urgent"
        />
        <CountTile
          tone="todo"
          label="Needs attention"
          value={attention ? `${attention.count}${attention.more ? "+" : ""}` : "–"}
          caption={attention ? attentionText(after) : COUNT_ERROR}
          href="/office/needs-attention"
        />
        <CountTile
          tone="wait"
          label="Waiting on others"
          value={String(payQueriesWaiting)}
          caption={payQueriesWaiting > 0 ? "Pay queries with payroll" : "Nothing waiting on others"}
          {...(payQueriesWaiting > 0 ? { href: "/office/pay-queries" } : {})}
        />
        <CountTile
          tone="done"
          label="Sorted today"
          value={String(sortedCount)}
          caption={[
            c.cancellations.ok &&
              `${plural(c.cancellations.data.total, "cancellation", "cancellations")}`,
            c.enquiries.ok && `${plural(c.enquiries.data.total, "enquiry", "enquiries")}`,
          ]
            .filter(Boolean)
            .join(", ")}
          href="#sorted"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          id="urgent-places"
          title="Urgent places to fill"
          tone="urgent"
          count={focus.length > 0 ? String(focus.length) : undefined}
          link={
            <Link href="/office/events?view=urgent" className={textLink}>
              All on Events &amp; sessions
            </Link>
          }
          className="lg:col-span-8"
        >
          {!d.urgent.ok ? (
            <p role="status" className="rounded-2xl bg-card px-3.5 py-3 text-attention-ink">
              {SECTION_ERROR}
            </p>
          ) : focus.length > 0 ? (
            <UrgentPlaces items={focus} labels={moreLabels(focus)} />
          ) : (
            <div className={`${LIFTED} flex flex-wrap items-center gap-4 p-4`}>
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-done-tile text-done-ink"
              >
                <Icon name="check" size={24} />
              </span>
              <div className="min-w-48 flex-1">
                <p className="text-lg font-semibold">
                  {SECTIONS.urgent.empty.replace("shift", "place")}
                </p>
                <p className="text-ink-muted">Nobody needs finding right now.</p>
              </div>
              <Link href="/office/events" className={btn.secondary}>
                See events
              </Link>
            </div>
          )}
          {d.urgent.ok && d.urgent.data.more && (
            <p className={meta}>More urgent places are on Events &amp; sessions.</p>
          )}
        </Panel>

        <Panel id="this-week" title="This week" tone="card" className="lg:col-span-4">
          {cells ? (
            <Week cells={cells} />
          ) : (
            <p role="status" className={meta}>
              {SECTION_ERROR}
            </p>
          )}
          <Link href="/office/events" className={`${btn.secondary} mt-auto w-full`}>
            Open the rota board
          </Link>
        </Panel>

        <Panel
          id="needs-attention"
          title="Needs attention"
          tone="todo"
          count={
            attention && attention.count > 0
              ? `${attention.count}${attention.more ? "+" : ""}`
              : undefined
          }
          className="lg:col-span-7"
        >
          {/* Needs attention unread: said so, with any row that could be worked out (enquiries). */}
          {!needs && (
            <p role="status" className="rounded-2xl bg-card px-3.5 py-3 text-attention-ink">
              {SECTION_ERROR}
            </p>
          )}
          {after.length > 0 ? (
            <Rows rows={after} tone="needs" label="Needs attention" />
          ) : (
            needs && (
              <p className={`${LIFTED} px-3.5 py-3 text-ink-muted`}>{SECTIONS.needs.empty}</p>
            )
          )}
          <Link href="/office/needs-attention" className={`${btn.secondary} mt-auto self-start`}>
            Open Needs attention
            <Icon name="arrow" size={16} />
          </Link>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <Panel id="waiting" title="Waiting on others" tone="wait">
            {waiting.length > 0 ? (
              <Rows rows={waiting} tone="waiting" label="Waiting on others" />
            ) : (
              <p className={`${LIFTED} px-3.5 py-3 text-ink-muted`}>
                Nothing is waiting on anyone else.
              </p>
            )}
          </Panel>
          <Panel id="sorted" title="Sorted today" tone="done">
            <Rows rows={sorted} tone="sorted" label="Sorted today" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

const LONG = (p: { long: string }) => p.long;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
