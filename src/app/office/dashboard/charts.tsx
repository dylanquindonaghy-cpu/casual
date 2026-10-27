"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type {
  BarsBody,
  CardTone,
  ChartCard,
  ChartTable,
  Column,
  ColumnsBody,
  CountCard,
  LegendItem,
  Mark,
  MarkTone,
  OffersBody,
  Tip,
  TimelineBody,
} from "@/lib/office/dashboard-charts";
import { notice, quietLink, table } from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { StatusChip } from "../../ui/status-chip";
import { usePanel } from "./chart-panel";

// The dashboard's four count cards and six charts (Phase 23, 23.4; the approved mock-up,
// docs/mockups/phase-23/; docs/screens.md `/office`), drawn from what the page built
// (src/lib/office/dashboard-charts.ts): HTML and CSS, no chart library. Colour means one thing
// everywhere (red urgent, amber needs you, blue waiting on someone else, green done, grey fine)
// and is never the only clue: every mark has its words (its name, its tooltip, its legend and its
// row in the Numbers table), and amber and grey bars carry their numbers.
//
// A mark is a button: under a mouse or when the keyboard reaches it (not on touch) its tooltip
// shows over it, its value first and then what it is (it floats: the office's one overlay). A row
// of bars has it beside the row instead, so it never covers the row above or below. The pointer
// can move onto the tooltip to read it, and Escape puts it away (WCAG 1.4.13); a click on it puts
// it away and goes on to what's under it, so a click is never lost. Picked, a mark opens its rows
// in the panel (./chart-panel.tsx) and the chart's other marks dim. Bars are at most 24px thick,
// 4px round at the data end and square at the baseline, with a 2px gap between the parts of a
// stack, on a hairline grid. A day chart keeps 24px a column on a laptop and 36px on a phone,
// where it scrolls sideways inside its card (the page never does); the cancellations chart starts
// scrolled to today, at its end. "Numbers" swaps a chart for its table.

const MARK_BG: Record<MarkTone, string> = {
  urgent: "bg-mark-urgent",
  open: "bg-mark-open",
  wait: "bg-mark-wait",
  done: "bg-mark-done",
  calm: "bg-mark-calm",
};

// A count card's icon chip: its colour's tint and ink.
const CARD_TILE: Record<CardTone, string> = {
  urgent: "bg-urgent-tile text-urgent-ink",
  attention: "bg-hivis text-on-hivis",
  wait: "bg-wait-tile text-wait-ink",
  done: "bg-done-tile text-done-ink",
};
const CARD_ICON: Record<CardTone, IconName> = {
  urgent: "urgent",
  attention: "bell",
  wait: "clock",
  done: "check",
};

// The four counts: white cards with their hairline, the label, then the number, then one line,
// and a tinted icon chip. A plain link to its list (it works without script); once the page is
// ready a click opens the list in the panel instead.
export function CountCards({ cards }: { cards: CountCard[] }) {
  const { open, ready } = usePanel();
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <a
          key={card.key}
          href={card.href}
          aria-haspopup={ready ? "dialog" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            open(card.panel, e.currentTarget, `card:${card.key}`);
          }}
          className="press grid grid-cols-[minmax(0,1fr)_auto] content-start gap-x-2 gap-y-3 glass rounded-inner p-4 text-ink hover:bg-button-hover sm:p-6"
        >
          <span className="col-start-1 row-start-1 self-center text-sm font-semibold text-ink-muted">
            {card.label}
          </span>
          <span className="col-span-2 row-start-2 font-stat text-4xl leading-none text-ink">
            {card.value}
          </span>
          <span className="col-span-2 row-start-3 text-sm text-ink-muted">{card.caption}</span>
          <span
            aria-hidden="true"
            className={`col-start-2 row-start-1 flex size-10 items-center justify-center rounded-row ${CARD_TILE[card.tone]}`}
          >
            <Icon name={CARD_ICON[card.tone]} size={20} />
          </span>
        </a>
      ))}
    </div>
  );
}

// Where a mark's tooltip goes: over it (or under it), or beside it (a row of bars).
type TipPlace = "over" | "beside";
type MarkProps = (
  m: Mark,
  place?: TipPlace,
) => {
  "aria-label": string;
  "aria-haspopup": "dialog";
  "data-tip": "beside" | undefined;
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
};

// Where a mark's tooltip goes, in the window's pixels: centred over the mark and 8px clear of it,
// or under it when there's no room above; never within 8px of the window's sides. `side` says
// which: the tooltip's invisible bridge covers the 8px gap on the side facing its mark, so the
// pointer can cross from the mark to the tooltip without leaving both.
export function tipSpot(
  mark: { left: number; top: number; bottom: number; width: number },
  box: { width: number; height: number },
  windowWidth: number,
): { left: number; top: number; side: "above" | "below" } {
  const left = Math.round(
    Math.max(8, Math.min(windowWidth - box.width - 8, mark.left + mark.width / 2 - box.width / 2)),
  );
  const above = mark.top - box.height - 8;
  return above < 8
    ? { left, top: Math.round(mark.bottom + 8), side: "below" }
    : { left, top: Math.round(above), side: "above" };
}

// Where a row's tooltip goes (a row of bars spans its card, and the rows are 4px apart, so over
// or under it would cover the next row): beside the row, level with its middle and 8px clear of
// it, to its right, or to its left when there's no room on the right. A window too narrow for
// either: on the side with more room. Never within 8px of the window's edges. The bridge covers
// the 8px on the side facing the row.
export function tipBeside(
  row: { left: number; right: number; top: number; height: number },
  box: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number; side: "right" | "left" } {
  const top = Math.round(
    Math.max(8, Math.min(view.height - box.height - 8, row.top + row.height / 2 - box.height / 2)),
  );
  const toRight = row.right + 8;
  const toLeft = row.left - 8 - box.width;
  if (toRight + box.width <= view.width - 8)
    return { left: Math.round(toRight), top, side: "right" };
  if (toLeft >= 8) return { left: Math.round(toLeft), top, side: "left" };
  return view.width - row.right >= row.left
    ? { left: Math.round(Math.max(8, view.width - 8 - box.width)), top, side: "right" }
    : { left: 8, top, side: "left" };
}

// How long the tooltip waits once the pointer leaves its mark (or the tooltip), so it can cross to
// the other.
const TIP_GRACE_MS = 100;

// A licence's name sits to the right of its dot, or to its left once the dot is past this far
// along the 8 weeks (so it never runs past the card's edge).
export const NAME_FLIP_PCT = 60;

// Dimmed while another mark of its chart has its rows open.
const fade = (dim: boolean) => `transition-opacity duration-200${dim ? " opacity-30" : ""}`;

export function DashboardCharts({
  charts,
  words,
}: {
  charts: ChartCard[];
  words: { section: string; count: string };
}) {
  const { open, current } = usePanel();
  const [numbers, setNumbers] = useState<Record<string, boolean>>({});
  const [tip, setTip] = useState<{ el: HTMLElement; tip: Tip } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The pointer is back on the mark or on its tooltip: it stays.
  const stay = () => {
    if (leaving.current !== null) clearTimeout(leaving.current);
    leaving.current = null;
  };
  const show = (el: HTMLElement, t: Tip) => {
    stay();
    setTip({ el, tip: t });
  };
  const hide = () => {
    stay();
    setTip(null);
  };
  // The pointer left the mark or its tooltip: it goes after a moment, unless the pointer reaches
  // the other first, or the keyboard is on the mark.
  const leave = () => {
    stay();
    leaving.current = setTimeout(() => {
      leaving.current = null;
      setTip((t) =>
        t && t.el === document.activeElement && t.el.matches(":focus-visible") ? t : null,
      );
    }, TIP_GRACE_MS);
  };

  // Over its mark, or under it with no room above; beside a row of bars; never off the window's
  // edges (the window less its scrollbar).
  useLayoutEffect(() => {
    const t = box.current;
    if (!tip || !t) return;
    const size = { width: t.offsetWidth, height: t.offsetHeight };
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const mark = tip.el.getBoundingClientRect();
    const at =
      tip.el.dataset.tip === "beside"
        ? tipBeside(mark, size, { width, height })
        : tipSpot(mark, size, width);
    t.style.left = `${at.left}px`;
    t.style.top = `${at.top}px`;
    t.dataset.side = at.side;
  }, [tip]);

  // Scrolling moves the mark: the tooltip follows a focused one, and goes for a pointer's. Escape
  // puts it away and focus stays where it is (the next mark focused or under the pointer shows its
  // own).
  useEffect(() => {
    if (!tip) return;
    const onScroll = () =>
      setTip(document.activeElement === tip.el ? { el: tip.el, tip: tip.tip } : null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (leaving.current !== null) clearTimeout(leaving.current);
      leaving.current = null;
      setTip(null);
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("keydown", onKey);
    };
  }, [tip]);

  // Nothing waits to hide a tooltip once the charts are gone.
  useEffect(
    () => () => {
      if (leaving.current !== null) clearTimeout(leaving.current);
    },
    [],
  );

  // The cancellations chart reads to today on its right: it starts scrolled to its end, and goes
  // back there when the window's width changes. Not when only its height does (a phone's toolbar
  // showing or hiding as the page scrolls): the chart stays where it was swiped.
  useEffect(() => {
    const toEnd = () =>
      document.querySelectorAll<HTMLElement>("[data-scroll-end]").forEach((el) => {
        el.scrollLeft = el.scrollWidth;
      });
    toEnd();
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      toEnd();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A click on the tooltip: it goes at once, and the click goes on to what's under the pointer
  // (the mark next to it, say), with the same keys held.
  const passOn = (e: MouseEvent<HTMLDivElement>) => {
    e.currentTarget.hidden = true;
    hide();
    document.elementFromPoint(e.clientX, e.clientY)?.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: e.detail,
        screenX: e.screenX,
        screenY: e.screenY,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        buttons: e.buttons,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      }),
    );
  };

  const markProps: MarkProps = (m, place = "over") => ({
    "aria-label": m.aria,
    "aria-haspopup": "dialog",
    "data-tip": place === "beside" ? "beside" : undefined,
    onPointerEnter: (e) => {
      if (e.pointerType !== "touch") show(e.currentTarget, m.tip);
    },
    // A touch goes at once, as before; a mouse's waits a moment, for the pointer to reach it.
    onPointerLeave: (e) => (e.pointerType === "touch" ? hide() : leave()),
    onFocus: (e) => {
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, m.tip);
    },
    onBlur: hide,
    onClick: (e) => {
      hide();
      open(m.panel, e.currentTarget, m.key);
    },
  });

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-2">
        {charts.map((c) => {
          const on = numbers[c.id] === true;
          const picked = current?.startsWith(`${c.id}:`) ? current : null;
          const dim = (m: Mark | null) => picked !== null && m?.key !== picked;
          return (
            <section
              key={c.id}
              aria-labelledby={c.id}
              className={`glass flex min-w-0 flex-col gap-4 rounded-inner p-4 has-[:target]:animate-landed sm:p-6${c.wide ? " xl:col-span-2" : ""}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {/* Where a link to the chart lands, and focus with it (from a panel). */}
                  <h2
                    id={c.id}
                    tabIndex={-1}
                    className="text-lg font-bold tracking-heading text-balance text-ink"
                  >
                    {c.title}
                  </h2>
                  {c.take && <p className="mt-1 text-base text-ink-muted">{c.take}</p>}
                </div>
                {c.body && (
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setNumbers((n) => ({ ...n, [c.id]: !on }))}
                    className="press-glass glass-button inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press aria-pressed:lens aria-pressed:text-ink"
                  >
                    Numbers
                  </button>
                )}
              </div>
              {c.error && (
                <>
                  <p className="flex items-baseline gap-2">
                    <span className="font-stat text-3xl leading-none text-ink">–</span>
                    <span className="text-sm text-ink-muted">{words.count}</span>
                  </p>
                  <p role="status" className={`${notice} flex items-start gap-2`}>
                    <Icon name="info" size={18} className="mt-1" />
                    {words.section}
                  </p>
                </>
              )}
              {c.empty && (
                <p className="rounded-row bg-raised px-4 py-6 text-center text-ink-muted">
                  {c.empty}
                </p>
              )}
              {c.body && (
                <>
                  {c.legend.length > 0 && <Legend items={c.legend} hidden={on} />}
                  <div hidden={on} className="min-w-0">
                    {c.body.kind === "columns" ? (
                      <Columns body={c.body} markProps={markProps} dim={dim} />
                    ) : c.body.kind === "bars" ? (
                      <Bars body={c.body} markProps={markProps} dim={dim} />
                    ) : c.body.kind === "offers" ? (
                      <Offers body={c.body} markProps={markProps} dim={dim} />
                    ) : (
                      <Timeline body={c.body} markProps={markProps} dim={dim} />
                    )}
                  </div>
                  <div hidden={!on} className="flex flex-col gap-4">
                    {c.tables.map((t) => (
                      <NumbersTable key={t.caption ?? "numbers"} t={t} />
                    ))}
                  </div>
                  {c.hint && (
                    <p hidden={on} className="text-sm text-ink-faint">
                      {c.hint}
                      {c.swipe && <span className="sm:hidden"> {c.swipe}</span>}
                    </p>
                  )}
                </>
              )}
              {c.notes.map((n, i) => (
                <p
                  key={n.text ?? i}
                  className="flex flex-wrap items-center gap-x-4 text-sm text-ink-muted"
                >
                  {n.text && <span>{n.text}</span>}
                  {n.links.map((l) =>
                    l.href.startsWith("#") ? (
                      <a key={l.href} href={l.href} className={quietLink}>
                        {l.text}
                      </a>
                    ) : (
                      <Link key={l.href} href={l.href} className={quietLink}>
                        {l.text}
                      </Link>
                    ),
                  )}
                </p>
              ))}
            </section>
          );
        })}
      </div>
      {/* It takes the pointer, and its bridge (`before:`: its own box and 8px more on the side
          facing its mark) covers the gap, so the pointer can move onto it and read it. A press on
          it leaves focus where it is (a focused mark keeps its tooltip until the click lands). */}
      <div
        ref={box}
        role="tooltip"
        hidden={tip === null}
        onPointerEnter={stay}
        onPointerLeave={leave}
        onMouseDown={(e) => e.preventDefault()}
        onClick={passOn}
        className="fixed top-0 left-0 z-50 w-max max-w-64 animate-pop rounded-row bg-ink px-3 py-2 text-sm text-on-ink shadow-float before:absolute before:inset-0 data-[side=above]:before:-bottom-2 data-[side=below]:before:-top-2 data-[side=left]:before:-right-2 data-[side=right]:before:-left-2"
      >
        {tip && (
          <>
            <b className="block text-base font-bold">{tip.tip.value}</b>{" "}
            <span className="block">{tip.tip.label}</span>
          </>
        )}
      </div>
    </>
  );
}

function Legend({ items, hidden }: { items: LegendItem[]; hidden: boolean }) {
  return (
    <ul
      role="list"
      hidden={hidden}
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted"
    >
      {items.map((l) => (
        <li key={l.label} className="inline-flex items-center gap-2">
          {l.tone === "tick" ? (
            <Icon name="check" size={16} className="text-mark-done" />
          ) : (
            <span
              aria-hidden="true"
              className={`size-3 shrink-0 ${l.round ? "rounded-full" : "rounded-mark"} ${MARK_BG[l.tone]}`}
            />
          )}
          {l.label}
        </li>
      ))}
    </ul>
  );
}

function NumbersTable({ t }: { t: ChartTable }) {
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        {t.caption && (
          <caption className="px-4 pt-3 text-left text-sm font-bold text-ink-muted">
            {t.caption}
          </caption>
        )}
        <thead>
          <tr>
            {t.head.map((h, i) => (
              <th key={h} scope="col" className={`${table.th}${i > 0 ? ` ${table.num}` : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, row) => (
            <tr key={row}>
              {r.map((v, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className={`${table.td} font-medium text-ink`}>
                    {v}
                  </th>
                ) : (
                  <td key={i} className={`${table.td} ${table.num}`}>
                    {v}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Draw<B> = { body: B; markProps: MarkProps; dim: (m: Mark | null) => boolean };

// Columns: one slot a day (or an age), the slot the button, its stack the mark; a 32px gutter for
// the grid's numbers.
function Columns({ body, markProps, dim }: Draw<ColumnsBody>) {
  const pct = (v: number) => `${(v / body.max) * 100}%`;
  return (
    <div
      className="overflow-x-auto overscroll-x-contain"
      data-scroll-end={body.end ? "" : undefined}
    >
      <div
        style={{ "--n": body.columns.length } as CSSProperties}
        className="min-w-[calc(2rem_+_var(--n)_*_2.25rem)] sm:min-w-[calc(2rem_+_var(--n)_*_1.5rem)]"
      >
        <div className="relative h-48">
          <div className="absolute top-6 right-0 bottom-0 left-8 border-b border-mark-base">
            {body.ticks.map((t) => (
              <span
                key={t}
                aria-hidden="true"
                className="absolute inset-x-0 h-px bg-mark-grid"
                style={{ bottom: pct(t) }}
              >
                <span className="absolute right-full bottom-0 mr-2 translate-y-1/2 text-xs leading-none text-ink-faint tabular-nums">
                  {t}
                </span>
              </span>
            ))}
            <div className="absolute inset-0 flex">
              {body.columns.map((col) => (
                <Slot key={col.key} col={col} pct={pct} markProps={markProps} dim={dim(col.mark)} />
              ))}
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="mt-2 flex pl-8">
          {body.columns.map((col) => (
            <span
              key={col.key}
              className={`flex min-w-0 flex-1 flex-col items-center text-center text-xs leading-4 ${col.dim ? "text-ink-faint" : "text-ink-muted"}`}
            >
              {col.top && <span className="hidden sm:block">{col.top}</span>}
              <span
                className={
                  col.now
                    ? "rounded-full bg-ink px-2 text-sm font-bold text-on-ink"
                    : `text-sm font-bold ${col.dim ? "text-ink-faint" : "text-ink"}`
                }
              >
                {col.bottom}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Slot({
  col,
  pct,
  markProps,
  dim,
}: {
  col: Column;
  pct: (v: number) => string;
  markProps: MarkProps;
  dim: boolean;
}) {
  const stack = (
    <span className="relative flex h-full w-3/5 max-w-6 flex-col-reverse">
      {col.segments.map((s, i) => (
        <span
          key={s.tone}
          style={{ height: pct(s.value) }}
          className={`block w-full shrink-0 ${MARK_BG[s.tone]}${i > 0 ? " border-b-2 border-transparent bg-clip-padding" : ""}${i === col.segments.length - 1 ? " rounded-t-mark" : ""} ${fade(dim)}`}
        />
      ))}
      {col.total > 0 && (
        <span
          style={{ bottom: `calc(${pct(col.total)} + 0.25rem)` }}
          className="absolute left-1/2 -translate-x-1/2 text-sm leading-none font-bold text-ink tabular-nums"
        >
          {col.total}
        </span>
      )}
      {col.full && (
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-mark-done">
          <Icon name="check" size={16} />
        </span>
      )}
    </span>
  );
  return col.mark ? (
    <button
      type="button"
      data-col={col.key}
      {...markProps(col.mark)}
      className="press relative flex min-w-0 flex-1 justify-center rounded-t-row hover:bg-raised"
    >
      {stack}
    </button>
  ) : (
    <span
      data-col={col.key}
      aria-hidden="true"
      className="relative flex min-w-0 flex-1 justify-center"
    >
      {stack}
    </span>
  );
}

// Bars along: a name, then the bar (its parts side by side, round at the end) and its number.
function Bars({ body, markProps, dim }: Draw<BarsBody>) {
  return (
    <ul role="list" className="flex flex-col gap-1">
      {body.rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            {...markProps(r.mark, "beside")}
            className="press grid min-h-12 w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-3 rounded-row px-2 py-2 text-left hover:bg-raised sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-4 sm:px-3"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink">
              <span className="min-w-0 break-words">
                {r.name}
                {r.sub && <span className="block text-xs font-medium text-ink-muted">{r.sub}</span>}
              </span>
              {r.hidden && <StatusChip tone="quiet">Hidden</StatusChip>}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-5 shrink-0"
                style={{ width: `calc(${r.total / body.max} * (100% - 2.5rem))` }}
              >
                {r.segments.map((s, i) => (
                  <span
                    key={s.tone}
                    style={{ width: `${(s.value / r.total) * 100}%` }}
                    className={`block h-full ${MARK_BG[s.tone]}${i > 0 ? " border-l-2 border-transparent bg-clip-padding" : ""}${i === r.segments.length - 1 ? " rounded-r-mark" : ""} ${fade(dim(r.mark))}`}
                  />
                ))}
              </span>
              <b className="text-sm font-bold text-ink tabular-nums">{r.total}</b>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Offers: one bar of three parts (said yes, waiting, said no or closed), its key as three
// numbers you can pick, then the sessions still waiting for a reply.
function Offers({ body, markProps, dim }: Draw<OffersBody>) {
  const shown = body.keys.filter((k) => k.n > 0);
  return (
    <div className="flex flex-col gap-4">
      <div role="img" aria-label={body.aria} className="flex h-6">
        {shown.map((k, i) => (
          <span
            key={k.key}
            style={{ width: `${(k.n / body.total) * 100}%` }}
            className={`block h-full min-w-1.5 ${MARK_BG[k.tone]}${i > 0 ? " border-l-2 border-transparent bg-clip-padding" : ""}${i === 0 ? " rounded-l-mark" : ""}${i === shown.length - 1 ? " rounded-r-mark" : ""} ${fade(dim(k.mark))}`}
          />
        ))}
      </div>
      <ul role="list" className="grid gap-2 sm:grid-cols-3">
        {body.keys.map((k) => {
          const inner = (
            <>
              <span className="font-stat text-3xl leading-none text-ink">{k.n}</span>
              <span className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <span
                  aria-hidden="true"
                  className={`size-3 shrink-0 rounded-mark ${MARK_BG[k.tone]}`}
                />
                {k.label}
              </span>
            </>
          );
          return (
            <li key={k.key}>
              {k.mark ? (
                <button
                  type="button"
                  {...markProps(k.mark)}
                  className="press glass-tile grid h-full w-full content-start gap-2 rounded-row p-4 text-left hover:bg-button-hover"
                >
                  {inner}
                </button>
              ) : (
                <div className="glass-tile grid h-full content-start gap-2 rounded-row p-4">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {body.waiting && (
        <>
          <h3 className="text-sm font-bold text-ink-muted">Still waiting for a reply</h3>
          <Bars body={body.waiting} markProps={markProps} dim={dim} />
          {body.waitingMore && <p className="text-sm text-ink-muted">{body.waitingMore}</p>}
        </>
      )}
    </div>
  );
}

// Licences: a dot each on the 8 weeks from today (close dates on the lanes above), a booking after
// it runs out bigger and named: the name to the right of its dot, or to its left past 60% along.
const AXIS = 32; // px from the foot: the dated line
const LANE = 30; // px between lanes
const FIRST = AXIS + 24; // the first lane's height

function Timeline({ body, markProps, dim }: Draw<TimelineBody>) {
  return (
    <div className="mx-4" style={{ height: `${FIRST + (body.lanes - 1) * LANE + 28}px` }}>
      <div className="relative h-full">
        <span aria-hidden="true" className="absolute inset-x-0 bottom-8 h-px bg-mark-base" />
        <span aria-hidden="true" className="absolute top-4 bottom-8 left-0 w-px bg-ink-faint" />
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 -translate-x-1/2 bg-panel px-1 text-xs leading-4 font-bold text-ink"
        >
          Today
        </span>
        {body.ticks.map((t) => (
          <span key={t.label} aria-hidden="true">
            <span
              className="absolute bottom-8 h-1.5 w-px bg-mark-base"
              style={{ left: `${t.x}%` }}
            />
            <span
              className={`absolute bottom-2 -translate-x-1/2 text-xs whitespace-nowrap text-ink-muted${t.alt ? " hidden sm:block" : ""}`}
              style={{ left: `${t.x}%` }}
            >
              {t.label}
            </span>
          </span>
        ))}
        {body.dots.map((d) => {
          const y = FIRST + d.lane * LANE;
          return (
            <span key={d.key}>
              <span
                aria-hidden="true"
                className="absolute bottom-8 w-px bg-button-line"
                style={{ left: `${d.x}%`, height: `${y - AXIS}px` }}
              />
              <button
                type="button"
                {...markProps(d.mark)}
                style={{ left: `${d.x}%`, bottom: `${y}px` }}
                className="press absolute flex size-11 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full"
              >
                <span
                  className={`block rounded-full border-2 border-card ${d.big ? "size-5" : "size-4"} ${MARK_BG[d.tone]} ${fade(dim(d.mark))}`}
                />
              </button>
              {d.name &&
                (d.x > NAME_FLIP_PCT ? (
                  <span
                    aria-hidden="true"
                    style={{ right: `${100 - d.x}%`, bottom: `${y}px` }}
                    className="pointer-events-none absolute hidden -translate-x-4 translate-y-1/2 text-sm font-bold whitespace-nowrap text-ink sm:block"
                  >
                    {d.name}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    style={{ left: `${d.x}%`, bottom: `${y}px` }}
                    className="pointer-events-none absolute hidden translate-x-4 translate-y-1/2 text-sm font-bold whitespace-nowrap text-ink sm:block"
                  >
                    {d.name}
                  </span>
                ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}
