"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  bannerText,
  cardLabel,
  COLUMN_IDS,
  COLUMN_TITLES,
  columnMoreText,
  countWords,
  emptyText,
  initials,
  markLabel,
  moreLabel,
  offeredLine,
  offerLabel,
  OVERNIGHT_LINE,
  pickHref,
  placesText,
  repliesText,
  showMoreText,
  sinceText,
  startsIn,
  takeCard,
  toMarkLine,
  toOfferLine,
  whenText,
  whereText,
  type ColumnKey,
} from "@/lib/office/board-copy";
import type { Board as BoardData, BoardSession, BoardShow } from "@/lib/office/dashboard-board";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { toMarkGroups } from "@/lib/office/to-mark";
import { roleLabel } from "@/lib/portal/format";
import { datePartsOfDay, timeRange } from "@/lib/portal/sign-copy";
import { localDateOf } from "@/lib/time/zoned";
import { btn, chip, countPill, notice } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { ShiftActions } from "../shift-actions";
import { useOfferPanel, type OpenOffer } from "./offer-panel";

// The dashboard's board (Phase 24, 24.3; round 7 of the canvas, docs/mockups/phase-24/README.md):
// beside the places chart, the detail card for the chosen session; under them four columns of
// glass: To offer and Offered (the sessions with places to fill under the track's filter, by
// whether an offer waits for a reply), While you were out (places casuals took from offers last
// night) and Who worked? (Needs attention's sessions to mark). A session card picks itself into the
// detail card (a link to the dashboard with that session until the page is ready, so it works
// without JavaScript), its paper plane opens the offer panel (a link to the offer page until then),
// and "Show N more" shows a column's other cards. The detail card's "Offer to someone" opens the
// panel too, "Open the shift" goes to its page, and "…" holds "Mark as filled" and "Not urgent".

export const SHOWN = 3; // cards a column shows before "Show N more"

// The id of a column's card's link ("to-offer-card-3"): "Show N more" moves focus to the first it
// showed.
const cardId = (k: ColumnKey, i: number) => `${COLUMN_IDS[k]}-card-${i}`;

// A plain click (not one opening a new tab or window): the page handles it once it's ready.
const plain = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

const LEAF: Record<ColumnKey, string> = {
  toOffer: "text-mark-open",
  offered: "text-mark-wait",
  overnight: "text-mark-done",
  toMark: "text-attention",
};

// A card's chips: 28px glass pills, tight enough that a card's three fit one line in a column a
// quarter of the board wide.
const CHIP =
  "glass-button inline-flex h-7 items-center gap-1 rounded-full px-2 text-sm whitespace-nowrap tabular-nums";
const CHIP_URGENT =
  "glass-rim inline-flex h-7 items-center gap-1 rounded-full bg-urgent-soft px-2 text-sm whitespace-nowrap text-urgent-ink tabular-nums";
const CHIP_DONE =
  "glass-rim inline-flex h-7 items-center gap-1 rounded-full bg-done-soft px-2 text-sm whitespace-nowrap text-done-ink tabular-nums";

// A date tile: the day's short name over its number, red when the session is urgent.
function DateTile({ day, urgent, big = false }: { day: string; urgent: boolean; big?: boolean }) {
  const p = datePartsOfDay(day);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-row leading-tight ${big ? "h-12 w-12" : "h-11 w-10"} ${urgent ? "glass-rim bg-urgent-tile text-urgent-ink" : "glass-button text-ink-muted"}`}
    >
      <span className="text-xs">{p.dow}</span>
      <b className={`${big ? "text-lg" : "text-base"} font-semibold ${urgent ? "" : "text-ink"}`}>
        {p.day}
      </b>
    </span>
  );
}

function SectionError() {
  return (
    <p role="status" className={`${notice} mt-3 flex items-start gap-2`}>
      <Icon name="info" size={18} className="mt-1" />
      {SECTION_ERROR}
    </p>
  );
}

// A column of the board: its leaf, title and count, its line, its cards (the first SHOWN, then
// "Show N more"), what it says when it's empty, and where the rest are when it was cut at 50.
function Column({
  k,
  count,
  line,
  failed,
  empty,
  cards,
  more,
}: {
  k: ColumnKey;
  count: number;
  line: string;
  failed: boolean;
  empty: string;
  cards: ReactNode[]; // each card's focusable link has the id cardId(k, i)
  more?: { text: string; href: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const id = COLUMN_IDS[k];
  const shown = open ? cards : cards.slice(0, SHOWN);
  const hidden = cards.length - shown.length;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="glass min-w-0 rounded-inner p-4">
      <div className="flex items-center gap-3 px-1">
        <Icon name="leaf" size={18} className={LEAF[k]} />
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-heading text-ink">
          {COLUMN_TITLES[k]}
        </h2>
        {!failed && (
          <>
            <span aria-hidden="true" className={countPill}>
              {count}
            </span>
            <span className="sr-only">{countWords[k](count)}</span>
          </>
        )}
      </div>
      {!failed && <p className="mt-1 px-1 text-sm text-ink-muted tabular-nums">{line}</p>}
      {failed ? (
        <SectionError />
      ) : cards.length === 0 ? (
        <p className="mt-3 rounded-row glass-tile p-4 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul role="list" className="mt-3 flex flex-col gap-2">
          {shown.map((card, i) => (
            <li key={i}>{card}</li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            // On to the first card it showed.
            requestAnimationFrame(() => document.getElementById(cardId(k, SHOWN))?.focus());
          }}
          className="press mt-2 flex min-h-10 w-full items-center justify-center rounded-row text-sm text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
        >
          {showMoreText(hidden)}
        </button>
      )}
      {more && (open || hidden === 0) && (
        <Link
          href={more.href}
          className="press mt-2 flex min-h-10 w-full items-center justify-center gap-1 rounded-row text-sm text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
        >
          {more.text}
          <Icon name="chevron" size={16} />
        </Link>
      )}
    </section>
  );
}

// A session with places to fill: its date, role and event; a chip with when it starts, one with
// how many to fill (red when urgent), one with the offers waiting; its paper plane.
function SessionCard({
  id,
  s,
  picked,
  show,
  timeZone,
  onPick,
  onOffer,
}: {
  id: string;
  s: BoardSession;
  picked: boolean;
  show: BoardShow;
  timeZone: string;
  onPick: (s: BoardSession) => void;
  onOffer: OpenOffer;
}) {
  return (
    <div
      data-session={s.shiftId}
      className={`press relative rounded-row px-3 py-4 ${picked ? "glass-button outline-2 -outline-offset-2 outline-ink" : "glass-tile hover:bg-active"}`}
    >
      <Link
        id={id}
        href={pickHref(show, s.shiftId)}
        prefetch={false}
        scroll={false}
        aria-label={cardLabel(s, timeZone)}
        aria-current={picked ? "true" : undefined}
        onClick={(e) => {
          if (!plain(e)) return;
          e.preventDefault();
          onPick(s);
        }}
        className="press absolute inset-0 rounded-row"
      />
      <div className="pointer-events-none relative flex items-start gap-3 pr-12">
        <DateTile day={localDateOf(s.startsAt, timeZone)} urgent={s.urgent} />
        <div className="min-w-0">
          <b className="block text-base leading-snug font-medium text-ink">{roleLabel(s.role)}</b>
          <span className="block text-sm leading-snug text-ink-muted">{s.eventName}</span>
        </div>
      </div>
      <Link
        href={`/office/offer/${s.shiftId}`}
        prefetch={false}
        aria-label={offerLabel(s, timeZone)}
        onClick={(e) => {
          if (!plain(e)) return;
          e.preventDefault();
          onOffer(s.shiftId, e.currentTarget);
        }}
        className="press-glass glass-button absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
      >
        <Icon name="send" size={16} />
      </Link>
      <div aria-hidden="true" className="pointer-events-none relative mt-3 flex flex-wrap gap-2">
        <span className={CHIP}>
          <Icon name="clock" size={14} className="text-ink-muted" />
          {timeRange(s.startsAt, s.endsAt, timeZone).range.split("–")[0]}
        </span>
        <span className={s.urgent ? CHIP_URGENT : CHIP}>
          <Icon name="profile" size={14} className={s.urgent ? "" : "text-ink-muted"} />
          {s.placesFree} to fill
        </span>
        {s.offers.waiting > 0 && (
          <span className={CHIP}>
            <Icon name="send" size={14} className="text-ink-muted" />
            {s.offers.waiting}
          </span>
        )}
      </div>
    </div>
  );
}

// The chosen session in full: what, where and when, how soon, its offers and what's in the way,
// and what to do about it. With none, what there is to fill under the filter says so.
function DetailCard({
  s,
  show,
  now,
  timeZone,
  failed,
  onOffer,
}: {
  s: BoardSession | null;
  show: BoardShow;
  now: Date;
  timeZone: string;
  failed: boolean;
  onOffer: OpenOffer;
}) {
  const [message, setMessage] = useState<{ id: string; words: string } | null>(null);
  if (failed)
    return (
      <section aria-label="Chosen session" className="glass rounded-inner p-6">
        <SectionError />
      </section>
    );
  if (!s)
    return (
      <section
        aria-label="Chosen session"
        className="glass flex flex-col items-start gap-4 rounded-inner p-6"
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-row bg-done-tile text-done-ink glass-rim"
        >
          <Icon name="check" size={24} />
        </span>
        <p className="text-lg font-semibold text-ink">{emptyText("toOffer", true, show)}</p>
      </section>
    );
  const soon = startsIn(s.startsAt, now, timeZone);
  const banner = bannerText(s, now, timeZone);
  return (
    <section
      aria-labelledby="chosen-title"
      data-chosen={s.shiftId}
      className="glass flex min-w-0 flex-col rounded-inner p-4 @min-[36rem]:p-6"
    >
      <div className="flex items-start gap-3">
        <DateTile day={localDateOf(s.startsAt, timeZone)} urgent={s.urgent} big />
        <div className="min-w-0 flex-1">
          <h2
            id="chosen-title"
            className="flex flex-wrap items-center gap-2 text-2xl leading-tight font-semibold tracking-heading text-ink"
          >
            {roleLabel(s.role)}
            {s.urgent && <span className={`${chip.base} ${chip.urgent}`}>Urgent</span>}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{whereText(s)}</p>
        </div>
        <ShiftActions
          key={s.shiftId}
          shiftId={s.shiftId}
          isUrgent={s.urgent}
          fromSheet={s.fromSheet}
          fromPlanner={s.fromPlanner}
          more={moreLabel(s, timeZone)}
          onMessage={(words) => setMessage({ id: s.shiftId, words })}
        />
      </div>
      <p className="mt-4 flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-row glass-tile px-4 py-3 text-sm tabular-nums">
        <b className="font-medium text-ink">{whenText(s, timeZone)}</b>
        <span className="text-ink-muted">{placesText(s.placesFree)}</span>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <p className="rounded-row glass-tile px-4 py-3">
          <span className="block text-sm text-ink-muted">Starts in</span>
          <b
            className={`mt-1 block font-stat text-3xl font-semibold ${soon.soon ? "text-urgent" : "text-ink"}`}
          >
            {soon.text}
          </b>
        </p>
        <p className="rounded-row glass-tile px-4 py-3">
          <span className="block text-sm text-ink-muted">Offers sent</span>
          <b className="mt-1 block font-stat text-3xl font-semibold text-ink">{s.offers.sent}</b>
          <small className="block text-sm text-ink-muted">{repliesText(s.offers)}</small>
        </p>
      </div>
      <p
        className={`mt-3 flex items-center gap-3 rounded-row px-4 py-3 text-sm glass-rim ${banner.tone === "amber" ? "bg-attention-soft text-attention-ink" : "bg-urgent-soft text-urgent-ink"}`}
      >
        <Icon name="urgent" size={18} />
        {banner.text}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Link
          href={`/office/offer/${s.shiftId}`}
          prefetch={false}
          onClick={(e) => {
            if (!plain(e)) return;
            e.preventDefault();
            onOffer(s.shiftId, e.currentTarget);
          }}
          className={`${btn.primary} grow whitespace-nowrap`}
        >
          Offer to someone
          <Icon name="arrow" size={17} />
        </Link>
        <Link
          href={`/office/shifts/${s.shiftId}`}
          className={`${btn.secondary} grow whitespace-nowrap`}
        >
          Open the shift
        </Link>
      </div>
      {message && message.id === s.shiftId && (
        <p role="status" className="mt-3 font-medium text-ink">
          {message.words}
        </p>
      )}
    </section>
  );
}

export function Board({
  board,
  chart,
}: {
  board: Pick<BoardData, "show" | "now" | "timeZone" | "gaps" | "overnight" | "toMark">;
  chart: ReactNode;
}) {
  const { show, now, timeZone, gaps, overnight, toMark } = board;
  const { open, panel } = useOfferPanel();
  const detail = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<BoardSession | null>(null);
  const g = gaps.ok ? gaps.data : null;
  const all = g ? [...g.toOffer.sessions, ...g.offered.sessions] : [];
  // The one picked while it's still on the board (the page's data may have changed since), else
  // the one the page chose.
  const current = (picked && all.find((s) => s.shiftId === picked.shiftId)) ?? g?.chosen ?? null;

  const pick = (s: BoardSession) => {
    setPicked(s);
    window.history.replaceState(null, "", pickHref(show, s.shiftId));
    // Where the detail card is out of sight (under the chart on a narrow screen), bring it in.
    const box = detail.current?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight))
      detail.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  };

  const sessionCards = (k: ColumnKey, list: BoardSession[]) =>
    list.map((s, i) => (
      <SessionCard
        key={s.shiftId}
        id={cardId(k, i)}
        s={s}
        picked={current?.shiftId === s.shiftId}
        show={show}
        timeZone={timeZone}
        onPick={pick}
        onOffer={open}
      />
    ));
  const rest = (column: { total: number; sessions: unknown[]; more: boolean }) =>
    column.more
      ? {
          text: columnMoreText(column.total - column.sessions.length),
          href: show === "urgent" ? "/office/events?view=urgent" : "/office/events?view=need",
        }
      : null;
  const nothingToFill = g !== null && g.toOffer.total + g.offered.total === 0;
  const night = overnight.ok ? overnight.data : null;
  const marks = toMark.ok ? toMark.data : null;

  return (
    <>
      <div className="grid gap-3 @min-[56rem]:grid-cols-[minmax(0,1fr)_21.25rem] @min-[72rem]:grid-cols-[minmax(0,1fr)_23.25rem]">
        {chart}
        <div ref={detail} className="flex min-w-0 flex-col [&>section]:flex-1">
          <DetailCard
            s={current}
            show={show}
            now={now}
            timeZone={timeZone}
            failed={!gaps.ok}
            onOffer={open}
          />
        </div>
      </div>
      <div className="grid items-start gap-3 @min-[36rem]:grid-cols-2 @min-[64rem]:grid-cols-4">
        <Column
          k="toOffer"
          count={g?.toOffer.total ?? 0}
          line={toOfferLine(g?.toOffer.places ?? 0)}
          failed={!g}
          empty={emptyText("toOffer", nothingToFill, show)}
          cards={sessionCards("toOffer", g?.toOffer.sessions ?? [])}
          more={g ? rest(g.toOffer) : null}
        />
        <Column
          k="offered"
          count={g?.offered.total ?? 0}
          line={offeredLine(g?.offered.places ?? 0, g?.offered.waiting ?? 0)}
          failed={!g}
          empty={emptyText("offered", nothingToFill, show)}
          cards={sessionCards("offered", g?.offered.sessions ?? [])}
          more={g ? rest(g.offered) : null}
        />
        <Column
          k="overnight"
          count={night?.takes.length ?? 0}
          line={OVERNIGHT_LINE}
          failed={!night}
          empty={emptyText("overnight", nothingToFill, show)}
          cards={(night?.takes ?? []).map((t, i) => {
            const c = takeCard(t, timeZone);
            const id = cardId("overnight", i);
            return (
              <div
                key={t.offerId}
                className="press relative rounded-row glass-tile px-3 py-4 hover:bg-active"
              >
                <Link
                  id={id}
                  href={`/office/shifts/${t.shiftId}`}
                  aria-label={c.label}
                  className="press absolute inset-0 rounded-row"
                />
                <div className="pointer-events-none relative flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wait-tile text-xs font-semibold text-wait-ink glass-rim"
                  >
                    {initials(t.worker)}
                  </span>
                  <div className="min-w-0">
                    <b className="block text-base leading-snug font-medium text-ink">{c.title}</b>
                    <span className="block text-sm leading-snug text-ink-muted">{c.sub}</span>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none relative mt-3 flex flex-wrap gap-2"
                >
                  <span className={CHIP}>
                    <Icon name="clock" size={14} className="text-ink-muted" />
                    {c.when}
                  </span>
                  <span className={CHIP_DONE}>
                    <Icon name="check" size={14} />
                    {c.said}
                  </span>
                </div>
              </div>
            );
          })}
        />
        <Column
          k="toMark"
          count={marks?.items.length ?? 0}
          line={toMarkLine(marks?.items ?? [], timeZone)}
          failed={!marks}
          empty={emptyText("toMark", nothingToFill, show)}
          cards={toMarkGroups(marks?.items ?? []).map((m, i) => {
            const one = m.sessions.length === 1;
            const id = cardId("toMark", i);
            return (
              <div
                key={m.sessions[0]!.shiftId}
                className="press relative rounded-row glass-tile px-3 py-4 hover:bg-active"
              >
                <Link
                  id={id}
                  href={
                    one
                      ? `/office/shifts/${m.sessions[0]!.shiftId}`
                      : "/office/needs-attention#to-mark"
                  }
                  aria-label={markLabel(m, m.sessions.length, timeZone)}
                  className="press absolute inset-0 rounded-row"
                />
                <div className="pointer-events-none relative flex items-start gap-3 pr-12">
                  <DateTile day={localDateOf(m.startsAt, timeZone)} urgent={false} />
                  <div className="min-w-0">
                    <b className="block text-base leading-snug font-medium text-ink">
                      {roleLabel(m.role)}
                    </b>
                    {m.site && (
                      <span className="block text-sm leading-snug text-ink-muted">{m.site}</span>
                    )}
                  </div>
                </div>
                <span
                  aria-hidden="true"
                  className="glass-button pointer-events-none absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-ink"
                >
                  <Icon name="check" size={16} />
                </span>
                <div
                  aria-hidden="true"
                  className="pointer-events-none relative mt-3 flex flex-wrap gap-2"
                >
                  <span className={CHIP}>
                    {one
                      ? timeRange(m.startsAt, m.endsAt, timeZone).range
                      : `${m.sessions.length} sessions`}
                  </span>
                  <span className={CHIP}>
                    <Icon name="clock" size={14} className="text-ink-muted" />
                    {sinceText(m.endsAt, now, timeZone)}
                  </span>
                </div>
              </div>
            );
          })}
          more={
            marks && marks.total > marks.items.length
              ? { text: "More on Needs attention", href: "/office/needs-attention#to-mark" }
              : null
          }
        />
      </div>
      {panel}
    </>
  );
}
