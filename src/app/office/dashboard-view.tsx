import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
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
import { btn, count as countStyle, countUrgent, quietLink } from "../ui/classes";
import { Icon, type IconName } from "../ui/icons";
import { UrgentPlaces } from "./urgent-places";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; Phases 18, 20 and
// 21), one question: "what needs me now, and where do I start?". A small date line (today, the
// week and its pay day); the greeting in the display serif with the one count of what needs you
// (the urgent places still to fill and Needs attention's items: the menu's count, so they add up)
// and where to start; the firm's shifts line, quiet. Four tinted cards (urgent places, needs
// attention, waiting on others, sorted today: hilos's), each jumping to its section; every urgent
// place in one rounded list (Apple Wallet's), each with "Offer" and "…" (mark as filled, not
// urgent); this week as a bar per day (Steep's), the places filled against the places; then Needs
// attention, "Waiting on others" (pay queries with payroll) and "Sorted today" (cancellations,
// recorded automatically; enquiries answered; what casuals can see) as tinted panels of white
// rows. Every section says when it couldn't load, and what it shows when it's empty; the page's
// loading skeleton is DashboardSkeleton (./office-skeleton.tsx). Pure: the page loads the data
// (src/lib/office/dashboard-home.ts works out what it says).

// A section's heading row: its icon, its name, its count (the grey pill; red for the urgent
// places), and a quiet link to the whole list at the end (hilos's "View all"). The heading's id is
// where its card jumps to.
function SectionHead({
  id,
  title,
  icon,
  count,
  urgent = false,
  link,
}: {
  id: string;
  title: string;
  icon: IconName;
  count?: string;
  urgent?: boolean;
  link?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center">
      <Icon name={icon} size={18} className="mr-2 text-ink-muted" />
      <h2 id={id} className="scroll-mt-20 text-lg font-semibold tracking-heading text-ink">
        {title}
      </h2>
      {count && <span className={urgent ? countUrgent : countStyle}>{count}</span>}
      {link && <span className="ml-auto pl-4">{link}</span>}
    </div>
  );
}

// A count card's colours: what it counts (a soft tint, its 1px edge a shade darker, its words in
// the tint's dark ink), and its icon.
const TILE = {
  urgent: { box: "border-urgent-line bg-urgent-tile", ink: "text-urgent-ink", icon: "urgent" },
  todo: { box: "border-attention-line bg-hivis", ink: "text-on-hivis", icon: "bell" },
  wait: { box: "border-wait-line bg-wait-tile", ink: "text-wait-ink", icon: "clock" },
  done: { box: "border-done-line bg-done-tile", ink: "text-done-ink", icon: "check" },
} as const satisfies Record<string, { box: string; ink: string; icon: IconName }>;

// Small tracked capitals: the date line over the greeting and each card's label (hilos's, as
// Dylan's brief asks; the taste skill would keep them in sentence case).
const DATE_LINE = "text-xs font-medium tracking-widest text-ink-muted uppercase tabular-nums"; // taste-skill-ignore: Dylan's brief
const CARD_LABEL = "text-xs font-semibold tracking-wider uppercase sm:tracking-widest"; // taste-skill-ignore: Dylan's brief

// The icon top-left, the label top-right, the number, then one grey line. The label comes first
// in the link (its name starts with it) and the number second.
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
  href: string;
}) {
  const t = TILE[tone];
  return (
    <Link
      href={href}
      className={`grid min-h-32 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-x-3 rounded-card border p-4 transition hover:shadow-soft active:scale-99 ${t.box}`}
    >
      <span className={`col-start-2 row-start-1 text-right ${CARD_LABEL} ${t.ink}`}>{label}</span>
      <span className="col-span-2 row-start-2 self-end pt-4 font-stat text-4xl leading-none text-ink">
        {value}
      </span>
      <span className="col-span-2 row-start-3 mt-2 text-sm text-ink-muted">{caption}</span>
      <Icon name={t.icon} size={20} className={`col-start-1 row-start-1 ${t.ink}`} />
    </Link>
  );
}

// A panel: a soft tint with its 1px edge, holding its heading and its rows (hilos's).
const PANEL = {
  todo: "border-attention-line bg-attention-soft",
  wait: "border-wait-line bg-wait-soft",
  done: "border-done-line bg-done-soft",
} as const;

function Panel({
  id,
  title,
  icon,
  tone,
  count,
  link,
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  tone: keyof typeof PANEL;
  count?: string;
  link?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`flex h-full min-w-0 flex-col gap-3 rounded-card border p-4 sm:p-6 ${PANEL[tone]}`}
    >
      <SectionHead id={id} title={title} icon={icon} count={count} link={link} />
      {children}
    </section>
  );
}

// What a section says when it couldn't load: in the section, with the rest of the page still there.
function SectionError() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink"
    >
      <Icon name="info" size={18} className="mt-1" />
      {SECTION_ERROR}
    </p>
  );
}

// A near-white row on its panel (hilos's), and an empty panel's one line in the same place.
const ROW =
  "flex min-h-16 items-center gap-3 rounded-row border border-line bg-card/80 px-4 py-3 text-ink";

// This week, Monday to Sunday (Steep's): the places still to fill as the big number at the
// bottom left, then a bar per day, its height the share of its places filled, against a dashed
// line where every place is filled. One colour; red on a day with urgent gaps; grey once a day has
// gone; today's name in a filled pill; an empty day says "No sessions". Each day is a link to its
// shifts (or its sessions to mark). Below 640px the bars lie down, one row a day, on their tracks.
function Week({ cells }: { cells: WeekCell[] }) {
  const sum = weekSummary(cells);
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:grid-rows-[1fr_auto_auto]">
      <p className="self-end font-stat text-4xl leading-none text-ink sm:row-start-1">
        {sum.toFill}
      </p>
      <p className="-mt-2 text-sm text-ink-muted sm:row-start-2">
        {sum.toFill === 1 ? "place" : "places"} still to fill.
        {sum.days && ` ${sum.filled} of ${sum.places} filled, ${sum.days}.`}
      </p>
      <nav
        aria-label="This week"
        className="relative min-w-0 sm:col-start-2 sm:row-span-3 sm:row-start-1 sm:pt-6"
      >
        {/* Every place filled: the bars' target, with its words at its end (from 640px). */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-8 hidden border-t border-dashed border-line-strong sm:block"
        >
          <span className="absolute right-0 bottom-full mb-1 text-xs text-ink-muted">
            All filled
          </span>
        </span>
        <ul role="list" className="flex flex-col gap-1 sm:grid sm:grid-cols-7 sm:gap-2">
          {cells.map((c) => (
            <li key={c.date}>
              <WeekDayLink c={c} />
            </li>
          ))}
        </ul>
      </nav>
      <Link
        href="/office/events"
        className={`${btn.secondary} w-full sm:row-start-3 sm:w-auto sm:self-start`}
      >
        Open the rota board
      </Link>
    </div>
  );
}

function WeekDayLink({ c }: { c: WeekCell }) {
  const today = c.dow === "Today";
  const fill = c.past ? "bg-line-strong" : c.note.kind === "urgent" ? "bg-urgent-fill" : "bg-ink";
  const share = { "--fill": `${Math.round(c.filledShare * 100)}%` } as CSSProperties;
  return (
    <Link
      href={c.href}
      aria-label={c.label}
      className="grid min-h-11 grid-cols-[4rem_minmax(0,1fr)_6rem] items-center gap-3 rounded-row px-2 transition-colors hover:bg-quiet-soft active:bg-raised sm:flex sm:flex-col sm:items-center sm:gap-2 sm:px-1 sm:py-2"
    >
      {/* The bar: on its track below 640px; standing, from the dashed line down, from there. */}
      <span
        aria-hidden="true"
        className="relative order-2 h-2 w-full overflow-hidden rounded-full bg-raised sm:order-1 sm:h-40 sm:w-4 sm:bg-transparent"
      >
        {c.places > 0 && (
          <span
            style={share}
            className={`absolute bottom-0 left-0 h-full w-(--fill) rounded-full sm:h-(--fill) sm:w-full ${fill}`}
          />
        )}
      </span>
      <span
        className={`order-1 flex h-6 items-center justify-self-start rounded-full text-xs sm:order-2 sm:justify-self-auto ${
          // Today on the ink pill keeps its own text colour (red on it would fail the contrast
          // test); the day's bar and words still say it's urgent.
          today
            ? "bg-ink px-2 font-semibold text-on-ink"
            : c.note.kind === "urgent"
              ? "font-semibold text-urgent"
              : "font-medium text-ink-muted"
        }`}
      >
        {c.dow}
      </span>
      <span className="order-3 flex h-8 items-center justify-end text-right text-xs leading-4 text-ink-muted tabular-nums sm:justify-center sm:text-center">
        {c.note.kind === "mark" ? (
          <span className="rounded-full bg-hivis px-2 py-1 font-semibold whitespace-nowrap text-on-hivis">
            {c.note.text}
          </span>
        ) : c.places === 0 ? (
          "No sessions"
        ) : c.past ? (
          "done"
        ) : (
          `${c.filled}/${c.places}`
        )}
      </span>
    </Link>
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

// Rows on their panel, each a link to where it's dealt with: Needs attention's and waiting on
// others' with their count (and Needs attention's with what to do, a quiet grey pill); sorted
// today's with a tick.
// `columns`: side by side from 1024px (two for Needs attention, three for Sorted today), so the
// panels beside each other end level.
function Rows({
  rows,
  tone,
  label,
  columns = 1,
}: {
  rows: Row[];
  tone: "needs" | "waiting" | "sorted";
  label: string;
  columns?: 1 | 2 | 3;
}) {
  const grid = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" }[columns];
  return (
    <ul role="list" aria-label={label} className={`grid gap-2 ${grid}`}>
      {rows.map((r) => (
        <li key={r.key}>
          <Link
            href={r.href}
            className={`${ROW} group h-full transition-colors hover:bg-card active:bg-quiet-soft`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.title}</span>
              <span className="block text-sm text-ink-muted">{r.sub}</span>
            </span>
            {tone === "sorted" ? (
              <Icon name="check" size={20} className="text-done" />
            ) : (
              <>
                {r.count !== null && <span className="font-stat text-lg">{r.count}</span>}
                {tone === "needs" && (
                  <span
                    aria-hidden="true"
                    className="hidden h-8 items-center rounded-full bg-button px-3 text-sm font-medium whitespace-nowrap transition-colors group-hover:bg-button-hover sm:inline-flex"
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
  // null: it couldn't be read (its card and section say so).
  payQueriesWaiting?: number | null;
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
    payQueriesWaiting !== null && payQueriesWaiting > 0
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
  const attentionFigure = attention ? `${attention.count}${attention.more ? "+" : ""}` : null;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className={DATE_LINE}>
          {LONG(today)} · Week {week.week} · Pay {dayLabel(week.payDay)}
        </p>
        <h1 className="text-ink">
          <span className="block font-display text-4xl">
            {greeting(now, d.timeZone)}, {firmName}.
          </span>{" "}
          <span className="mt-2 block text-2xl font-semibold tracking-heading">
            {headline(things, complete)}.
          </span>
        </h1>
        <p className="text-lg text-ink-muted">
          {startLine(focus[0], things, complete, urgentPlaces)}
        </p>
        {shiftsLine && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Icon name="phone" size={16} />
            {shiftsLine}
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          href="#urgent-places"
        />
        <CountTile
          tone="todo"
          label="Needs attention"
          value={attentionFigure ?? "–"}
          caption={attention ? attentionText(after) : COUNT_ERROR}
          href="#needs-attention"
        />
        <CountTile
          tone="wait"
          label="Waiting on others"
          value={payQueriesWaiting === null ? "–" : String(payQueriesWaiting)}
          caption={
            payQueriesWaiting === null
              ? COUNT_ERROR
              : payQueriesWaiting > 0
                ? "Pay queries with payroll"
                : "Nothing waiting on others"
          }
          href="#waiting"
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

      <section aria-labelledby="urgent-places" className="flex min-w-0 flex-col gap-3">
        <SectionHead
          id="urgent-places"
          title="Urgent places to fill"
          icon="urgent"
          count={focus.length > 0 ? String(focus.length) : undefined}
          urgent
          link={
            <Link href="/office/events?view=urgent" className={quietLink}>
              All on Events &amp; sessions
              <Icon name="chevron" size={16} />
            </Link>
          }
        />
        {!d.urgent.ok ? (
          <SectionError />
        ) : focus.length > 0 ? (
          <UrgentPlaces items={focus} labels={moreLabels(focus)} />
        ) : (
          <div className="flex flex-wrap items-center gap-4 rounded-card bg-card p-4 shadow-soft sm:p-6">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-row bg-done-tile text-done-ink"
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
          <p className="text-sm text-ink-muted">More urgent places are on Events &amp; sessions.</p>
        )}
      </section>

      <section
        aria-labelledby="this-week"
        className="flex min-w-0 flex-col gap-4 rounded-card bg-card p-4 shadow-soft sm:p-6"
      >
        <SectionHead id="this-week" title="This week" icon="shifts" />
        {cells ? <Week cells={cells} /> : <SectionError />}
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <Panel
            id="needs-attention"
            title="Needs attention"
            icon="bell"
            tone="todo"
            count={attention && attention.count > 0 ? (attentionFigure ?? undefined) : undefined}
            link={
              <Link href="/office/needs-attention" className={quietLink}>
                Open Needs attention
                <Icon name="chevron" size={16} />
              </Link>
            }
          >
            {/* Needs attention unread: said so, with any row that could be worked out
                (enquiries). */}
            {!needs && <SectionError />}
            {after.length > 0 ? (
              <Rows rows={after} tone="needs" label="Needs attention" columns={2} />
            ) : (
              needs && <p className={`${ROW} text-ink-muted`}>{SECTIONS.needs.empty}</p>
            )}
          </Panel>
        </div>
        <div className="min-w-0 lg:col-span-4">
          <Panel id="waiting" title="Waiting on others" icon="clock" tone="wait">
            {payQueriesWaiting === null ? (
              <SectionError />
            ) : waiting.length > 0 ? (
              <Rows rows={waiting} tone="waiting" label="Waiting on others" />
            ) : (
              <p className={`${ROW} text-ink-muted`}>Nothing is waiting on anyone else.</p>
            )}
          </Panel>
        </div>
        <div className="min-w-0 lg:col-span-12">
          <Panel id="sorted" title="Sorted today" icon="check" tone="done">
            <Rows rows={sorted} tone="sorted" label="Sorted today" columns={3} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

const LONG = (p: { long: string }) => p.long;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
