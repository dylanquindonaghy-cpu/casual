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
// (src/lib/office/dashboard-home.ts works out what it says). Phase 22 (round 2, Dylan's approved
// mock-up, no gradients): the four cards in full flat colour with a fine grain and a coloured
// glow beneath, lifting under the pointer and dipping when pressed, and the section a card jumps to
// shows where you landed (`animate-landed`); each section's icon in a small raised chip; this
// week's bars set in grooves, a day with no sessions striped, its details over it under the
// pointer or on focus; the panels' rows raised off their washes.

// A section's heading row: its icon, its name, its count (the grey pill; red for the urgent
// places), and a quiet link to the whole list at the end (hilos's "View all"). The heading's id is
// where its card jumps to.
// Its icon sits in a small round chip: in the section's colour (`chip`), or white and raised.
function SectionHead({
  id,
  title,
  icon,
  count,
  urgent = false,
  chip = "bg-card text-ink-muted shadow-raise",
  link,
}: {
  id: string;
  title: string;
  icon: IconName;
  count?: string;
  urgent?: boolean;
  chip?: string;
  link?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center">
      <span
        aria-hidden="true"
        className={`mr-3 flex size-7 shrink-0 items-center justify-center rounded-full ${chip}`}
      >
        <Icon name={icon} size={16} />
      </span>
      <h2 id={id} className="scroll-mt-20 text-lg font-semibold tracking-heading text-ink">
        {title}
      </h2>
      {count && <span className={urgent ? countUrgent : countStyle}>{count}</span>}
      {link && <span className="ml-auto pl-4">{link}</span>}
    </div>
  );
}

// A count card's colours (Phase 22): what it counts in full flat colour, with its edge and glow
// (`tint-…`, globals.css), its words in the colour's dark ink (light in dark), and its icon.
const TILE = {
  urgent: { box: "tint-urgent", ink: "text-urgent-card-ink", icon: "urgent" },
  todo: { box: "tint-attention", ink: "text-attention-card-ink", icon: "bell" },
  wait: { box: "tint-wait", ink: "text-wait-card-ink", icon: "clock" },
  done: { box: "tint-done", ink: "text-done-card-ink", icon: "check" },
} as const satisfies Record<string, { box: string; ink: string; icon: IconName }>;

// Small tracked capitals: the date line over the greeting and each card's label (hilos's, as
// Dylan's brief asks; the taste skill would keep them in sentence case).
const DATE_LINE = "text-xs font-medium tracking-widest text-ink-muted uppercase tabular-nums"; // taste-skill-ignore: Dylan's brief
const CARD_LABEL = "text-xs font-semibold tracking-wider uppercase sm:tracking-widest"; // taste-skill-ignore: Dylan's brief

// The icon top-left (in its round chip), the label top-right, the number, then one line. The label
// comes first in the link (its name starts with it) and the number second. Under the pointer the
// card lifts 2px; pressed, it dips and springs back (`press`). A plain link to its section on this
// page (not Next's <Link>, whose pushState never sets :target), so the section can show where you
// landed.
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
    <a
      href={href}
      className={`press grain grid min-h-32 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-x-3 rounded-card p-4 shadow-tint hover:-translate-y-0.5 ${t.box}`}
    >
      <span className={`col-start-2 row-start-1 self-center text-right ${CARD_LABEL} ${t.ink}`}>
        {label}
      </span>
      <span className="col-span-2 row-start-2 self-end pt-4 font-stat text-4xl leading-none text-ink">
        {value}
      </span>
      <span className={`col-span-2 row-start-3 mt-2 text-sm ${t.ink}`}>{caption}</span>
      <span
        aria-hidden="true"
        className={`card-chip col-start-1 row-start-1 flex size-8 items-center justify-center rounded-full ${t.ink}`}
      >
        <Icon name={t.icon} size={16} />
      </span>
    </a>
  );
}

// A panel: its colour's wash with a faint grain and its 1px edge, holding its heading (its icon in
// the colour's chip) and its rows (hilos's), raised off the page.
const PANEL = {
  todo: "border-attention-line bg-attention-soft",
  wait: "border-wait-line bg-wait-soft",
  done: "border-done-line bg-done-soft",
} as const;
const PANEL_CHIP = {
  todo: "bg-hivis text-on-hivis",
  wait: "bg-wait-tile text-wait-ink",
  done: "bg-done-tile text-done-ink",
} as const;
// Where a card's jump lands: the section shows it for a moment (`animate-landed`).
const LANDS = "rounded-card has-[:target]:animate-landed";

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
      className={`grain-soft flex h-full min-w-0 flex-col gap-3 border p-4 shadow-soft sm:p-6 ${LANDS} ${PANEL[tone]}`}
    >
      <SectionHead
        id={id}
        title={title}
        icon={icon}
        count={count}
        chip={PANEL_CHIP[tone]}
        link={link}
      />
      {children}
    </section>
  );
}

// What a section says when it couldn't load: in the section, with the rest of the page still there.
function SectionError() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink shadow-soft"
    >
      <Icon name="info" size={18} className="mt-1" />
      {SECTION_ERROR}
    </p>
  );
}

// A white row raised off its panel (hilos's), and an empty panel's one line in the same place.
const ROW = "flex min-h-16 items-center gap-3 rounded-row bg-card px-4 py-3 text-ink shadow-raise";

// This week, Monday to Sunday (Steep's): the places still to fill as the big number at the
// bottom left, then a bar per day, its height the share of its places filled, standing in its
// groove (Phase 22: the groove's top is every place filled; Phase 21's dashed line). One colour;
// red on a day with urgent gaps; grey once a day has gone; today's name in a filled pill; a day
// with no sessions striped, "No sessions" under it ("–" on a phone). Each day is a link to its
// shifts (or its sessions to mark), and under the pointer or on focus its details show over it.
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
        className="min-w-0 pt-6 sm:col-start-2 sm:row-span-3 sm:row-start-1"
      >
        <ul role="list" className="grid grid-cols-7 gap-1 sm:gap-2">
          {cells.map((c, i) => (
            <li key={c.date} className="min-w-0">
              <WeekDayLink c={c} edge={i === 0 ? "start" : i === cells.length - 1 ? "end" : null} />
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

// A day's details over it: centred on the day, or from its edge for the first and last (so it
// never runs off a phone).
const TIP_AT = {
  start: "left-0 origin-bottom-left",
  end: "right-0 origin-bottom-right",
  middle: "left-1/2 -translate-x-1/2 origin-bottom",
} as const;

function WeekDayLink({ c, edge }: { c: WeekCell; edge: "start" | "end" | null }) {
  const today = c.dow === "Today";
  const fill = c.past ? "bg-line-strong" : c.note.kind === "urgent" ? "bg-urgent-fill" : "bg-ink";
  const share = { "--fill": `${Math.round(c.filledShare * 100)}%` } as CSSProperties;
  return (
    <Link
      href={c.href}
      aria-label={c.label}
      className="press group/day relative flex min-h-11 flex-col items-center gap-2 rounded-row px-1 pb-1 hover:bg-quiet-soft active:bg-raised"
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max max-w-48 animate-pop rounded-row bg-card px-3 py-2 text-left text-xs text-ink shadow-float group-hover/day:block group-focus-visible/day:block ${TIP_AT[edge ?? "middle"]}`}
      >
        {c.label}
      </span>
      {/* The groove, and the bar standing in it. */}
      <span
        aria-hidden="true"
        className={`flex h-32 w-full max-w-11 items-end overflow-hidden rounded-row bg-raised inset-shadow-sunk sm:h-40 ${c.places === 0 ? "stripes" : ""}`}
      >
        {c.places > 0 && <span style={share} className={`h-(--fill) w-full rounded-row ${fill}`} />}
      </span>
      <span
        className={`flex h-6 items-center rounded-full text-xs ${
          // Today on the ink pill keeps its own text colour (red on it would fail the contrast
          // test); the day's bar and words still say it's urgent.
          today
            ? "bg-ink px-2 font-semibold text-on-ink"
            : c.note.kind === "urgent"
              ? "font-semibold text-urgent"
              : "font-medium text-ink-muted"
        }`}
      >
        {today ? (
          <>
            <span className="sm:hidden">{datePartsOfDay(c.date).dow}</span>
            <span className="hidden sm:inline">{c.dow}</span>
          </>
        ) : (
          c.dow
        )}
      </span>
      <span className="flex h-8 items-center justify-center text-center text-xs leading-4 text-ink-muted tabular-nums">
        {c.note.kind === "mark" ? (
          <span className="rounded-full border border-attention-line bg-hivis px-2 py-1 font-semibold whitespace-nowrap text-on-hivis">
            <span className="sm:hidden">{c.note.text.split(" ")[0]}</span>
            <span className="hidden sm:inline">{c.note.text}</span>
          </span>
        ) : c.places === 0 ? (
          <>
            <span className="sm:hidden">–</span>
            <span className="hidden sm:inline">No sessions</span>
          </>
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
// `columns`: side by side from 1024px (three for Sorted today). Needs attention's are one to a
// line (Phase 22; two side by side in Phase 21 squeezed their words).
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
            className={`${ROW} press group h-full hover:-translate-y-0.5 active:bg-quiet-soft`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{r.title}</span>
              <span className="block text-sm text-ink-muted">{r.sub}</span>
            </span>
            {tone === "sorted" ? (
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-done-fill text-on-done shadow-raise"
              >
                <Icon name="check" size={16} />
              </span>
            ) : (
              <>
                {r.count !== null && <span className="font-stat text-lg">{r.count}</span>}
                {tone === "needs" && (
                  <span
                    aria-hidden="true"
                    className="hidden h-8 items-center rounded-full bg-button px-3 text-sm font-medium whitespace-nowrap shadow-raise transition-colors group-hover:bg-button-hover sm:inline-flex"
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

      <section aria-labelledby="urgent-places" className={`flex min-w-0 flex-col gap-3 ${LANDS}`}>
        <SectionHead
          id="urgent-places"
          title="Urgent places to fill"
          icon="urgent"
          count={focus.length > 0 ? String(focus.length) : undefined}
          urgent
          chip="bg-urgent-tile text-urgent-ink"
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
              <Rows rows={after} tone="needs" label="Needs attention" />
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
