"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  bannerText,
  boardHref,
  cardLabel,
  COLUMN_IDS,
  COLUMN_TITLES,
  countWords,
  EMPTY_HINTS,
  emptyText,
  moreLabel,
  offerLabel,
  ON_YOUR_CONTRACTS,
  placesText,
  startsIn,
  toFillLine,
  toMarkLine,
  viewAllText,
  whenText,
  whereText,
  type BoardView,
  type ColumnKey,
} from "@/lib/office/board-copy";
import {
  COMING_UP_ALL,
  COMING_UP_ALL_HREF,
  comingUpEmpty,
  comingUpLine,
} from "@/lib/office/coming-up-copy";
import type { Board as BoardData, BoardSession, BoardShow } from "@/lib/office/dashboard-board";
import { SECTION_ERROR } from "@/lib/office/dashboard-copy";
import { DEFAULT_CARDS, type DashboardCard } from "@/lib/office/dashboard-cards";
import type { MapVenue, Takers } from "@/lib/office/dashboard-map";
import {
  bookedText,
  canTakeLine,
  lengthAndPay,
  offerButton,
  offeredText,
  STEP_BEFORE,
  STEP_NEXT,
  stepPosition,
  takersWarning,
} from "@/lib/office/dashboard-map-copy";
import { stepperAt, stepTo, venueSessions } from "@/lib/office/venue-map-geo";
import { roleLabel } from "@/lib/portal/format";
import { datePartsOfDay, timeRange } from "@/lib/portal/sign-copy";
import { localDateOf } from "@/lib/time/zoned";
import { btn, chip, countPill, notice } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { ShiftActions } from "../shift-actions";
import { ComingUpList } from "./coming-up";
import { plainClick as plain, useOfferPanel, type OpenOffer } from "./offer-panel";
import { UpdatesList, WhoWorkedList } from "./updates-worked";
import { VenueMap } from "./venue-map";

// The dashboard's board (Phase 24, 24.3; round 8 since Phase 26.2: the spec page's "Dashboard",
// docs/mockups/round-8/): the venue map (./venue-map.tsx) with the chosen session's card on it
// (under it on a phone), then the columns of glass: To offer (every session with places to fill
// under the track's filter, soonest first), Updates (the last two days: places taken, casuals'
// cancellations and offers with no reply: in place of round 7's Offered and While you were out),
// Coming up (Phase 27.9) and Who worked? (each person by name, with Worked and Didn't attend: under
// Customise since Phase 27.9).
//
// Phase 27.4 ("the map you can use"; Dylan, 2026-11-04, on docs/mockups/round-8/27.4-map/): with
// the map shown, To offer is a list on it (its button top right; every session, then "View all"),
// so the other columns chosen are the ones under it; with the map off, To offer is the column it
// was (the first four, then "View all").
//
// Phase 27.9 (Dylan, 2026-11-05): the columns under the map are about the person's contracts.
// Updates holds their changes (places taken, cancellations, offers with no reply: no more uploads
// to check, which stay on Needs attention and the Updates page), "On your contracts" under it when
// the board is narrowed to them; Coming up (./coming-up.tsx) took Who worked?'s place: who's
// working on them today and tomorrow, by session. Who worked? is still here for anyone who ticks it
// under Customise (off until then), after Coming up. Picking a session (a row, a pin, the card's arrows) shows
// it in the card at once, then the page loads who can take it (the address's `?session=`: the board
// and its map stay as they are, as their key has no session); a pin or a row moves the street map
// to the venue. A venue with more than one session in the view gets a row at the card's top:
// "‹ Acme Demo Arena · 1 of 2 ›". A row and a pin are links to the dashboard with that session until
// the page is ready, so they work without JavaScript; a row's paper plane opens the offer panel (a
// link to the offer page until then). The card shows what, where and when, its pay, how many are
// booked of how many (a gauge), who can take it under the rules right now, what's in the way, and
// "Offer to someone" ("Offer to Zoe" when she's the only one), "Open the session" and "…".
//
// Phase 27.10 (Dylan, 2026-11-05: "more ctas and data here on the dash but keep it simple"): the
// columns under the map act too, one small action a row at most. Each update has its own ("Offer
// the place", "See the record", "Open the session", "See the offers"), and a Coming up session with
// places to offer has "Offer 1 place"; an offer opens this board's offer panel, as To offer's paper
// plane does (offer-panel.tsx OfferLink).

export const SHOWN = 4; // To offer's rows before "View all" (round 8), as a column under the map

const LEAF: Record<ColumnKey, string> = {
  toOffer: "text-mark-open",
  updates: "text-mark-wait",
  comingUp: "text-mark-done",
  toMark: "text-attention-ink",
};

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

// A column of the board: its leaf, title and count, its line, what's in it (or what it says when
// it's empty), and its foot ("View all 17", the action log, Needs attention). `float`: To offer as
// the list on the map (Phase 27.4), floating glass that scrolls inside where the map holds it.
function Column({
  k,
  count,
  line,
  failed,
  empty,
  children,
  foot,
  float = false,
}: {
  k: ColumnKey;
  count: number;
  line: string | null;
  failed: boolean;
  empty: string;
  children: ReactNode;
  foot?: { text: string; href: string } | null;
  float?: boolean;
}) {
  const id = COLUMN_IDS[k];
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`${float ? "glass-float @min-[64rem]:min-h-0 @min-[64rem]:overflow-y-auto" : "glass"} min-w-0 rounded-inner p-4`}
    >
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
      {!failed && line && <p className="mt-1 px-1 text-sm text-ink-muted tabular-nums">{line}</p>}
      {failed ? (
        <SectionError />
      ) : count === 0 ? (
        <div className="mt-3 rounded-row glass-tile p-4 text-sm">
          <p className="text-ink-muted">{empty}</p>
          {EMPTY_HINTS[k] && <p className="mt-1 text-ink-faint">{EMPTY_HINTS[k]}</p>}
        </div>
      ) : (
        children
      )}
      {!failed && foot && (
        <Link
          href={foot.href}
          className="press mt-2 flex min-h-11 w-full items-center justify-center gap-1 rounded-row text-sm text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
        >
          {foot.text}
          <Icon name="chevron" size={16} />
        </Link>
      )}
    </section>
  );
}

// A session with places to fill, in To offer: its date, role (and "Urgent"), venue and start, how
// many are booked of how many, and its paper plane.
function OfferRow({
  s,
  picked,
  view,
  timeZone,
  onPick,
  onOffer,
}: {
  s: BoardSession;
  picked: boolean;
  view: BoardView;
  timeZone: string;
  onPick: (s: BoardSession) => void;
  onOffer: OpenOffer;
}) {
  const start = timeRange(s.startsAt, s.endsAt, timeZone).range.split("–")[0];
  return (
    <div
      data-session={s.shiftId}
      className={`press relative grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-row px-3 py-3 ${picked ? "glass-button outline-2 -outline-offset-2 outline-ink" : "glass-tile hover:bg-active"}`}
    >
      <Link
        href={boardHref(view, s.shiftId)}
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
      <span className="pointer-events-none relative">
        <DateTile day={localDateOf(s.startsAt, timeZone)} urgent={s.urgent} />
      </span>
      <span className="pointer-events-none relative min-w-0">
        <b className="flex flex-wrap items-center gap-2 leading-snug font-medium text-ink">
          {roleLabel(s.role)}
          {s.urgent && <span className={`${chip.base} ${chip.urgent}`}>Urgent</span>}
        </b>
        <span className="block text-sm leading-snug text-ink-muted">
          {[s.site ?? s.eventName, start].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none relative text-right text-sm leading-tight text-ink-muted tabular-nums"
      >
        <b className="block font-semibold text-ink">
          {bookedText(s.headcount - s.placesFree, s.headcount).replace(" / ", "/")}
        </b>
        booked
      </span>
      <Link
        href={`/office/offer/${s.shiftId}`}
        prefetch={false}
        aria-label={offerLabel(s, timeZone)}
        onClick={(e) => {
          if (!plain(e)) return;
          e.preventDefault();
          onOffer(s.shiftId, e.currentTarget);
        }}
        className="press-glass glass-button relative flex size-11 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
      >
        <Icon name="send" size={16} />
      </Link>
    </div>
  );
}

// How many are booked of how many, as a half-circle gauge (decorative: the words say it).
function Gauge({
  booked,
  headcount,
  urgent,
}: {
  booked: number;
  headcount: number;
  urgent: boolean;
}) {
  const share = headcount > 0 ? Math.min(1, booked / headcount) : 0;
  const r = 40;
  const length = Math.PI * r;
  return (
    <svg aria-hidden="true" viewBox="0 0 100 56" className="h-14 w-25">
      <path
        d="M10 50 A40 40 0 0 1 90 50"
        fill="none"
        stroke="var(--color-mark-base)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M10 50 A40 40 0 0 1 90 50"
        fill="none"
        stroke={urgent ? "var(--color-mark-urgent)" : "var(--color-mark-open)"}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${share * length} ${length}`}
      />
    </svg>
  );
}

// The card's round arrows (Phase 27.4): clear glass, 44px; at an end, still focusable but off.
const STEP =
  "press-glass glass-button flex size-11 shrink-0 items-center justify-center rounded-full text-ink not-aria-disabled:hover:bg-button-hover not-aria-disabled:active:bg-button-press aria-disabled:cursor-not-allowed aria-disabled:opacity-35";

// The chosen session (round 8's card on the map): what, where and when, its length and pay, how
// many are booked of how many, who can take it under the rules right now (and what's in the way),
// and what to do about it. With none, what there is to fill under the filter says so. Its venue
// with more than one session in the view (`steps`; Phase 27.4): a row at its top, "‹ Acme Demo
// Arena · 1 of 2 ›", the arrows to the session before and the next one (off at the ends: it never
// wraps round); a screen reader hears the new position.
function DetailCard({
  s,
  takers,
  show,
  now,
  timeZone,
  failed,
  onOffer,
  steps = null,
  onStep,
}: {
  s: BoardSession | null;
  takers: Takers | null;
  show: BoardShow;
  now: Date;
  timeZone: string;
  failed: boolean;
  onOffer: OpenOffer;
  steps?: { index: number; count: number } | null;
  onStep?: (by: -1 | 1) => void;
}) {
  const [message, setMessage] = useState<{ id: string; words: string } | null>(null);
  if (failed)
    return (
      <section aria-label="Chosen session" className="glass-float rounded-inner p-6">
        <SectionError />
      </section>
    );
  if (!s)
    return (
      <section
        aria-label="Chosen session"
        className="glass-float flex flex-col items-start gap-4 rounded-inner p-6"
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
  // While an offer waits for a reply, who hasn't replied matters more than who else could take it.
  const warning = s.offers.waiting > 0 ? null : takersWarning(takers);
  const booked = s.headcount - s.placesFree;
  const share = s.headcount > 0 ? booked / s.headcount : 0;
  const first = steps?.index === 0;
  const last = steps ? steps.index === steps.count - 1 : false;
  return (
    <section
      aria-labelledby="chosen-title"
      data-chosen={s.shiftId}
      className="glass-float relative flex min-w-0 flex-col gap-3 rounded-inner p-4 @min-[64rem]:in-data-map-card:min-h-0 @min-[64rem]:in-data-map-card:overflow-y-auto has-[details[open]]:z-10"
    >
      {steps && (
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <button
            type="button"
            aria-label={STEP_BEFORE}
            aria-disabled={first || undefined}
            onClick={() => !first && onStep?.(-1)}
            className={STEP}
          >
            <Icon name="chevron" size={18} className="rotate-180" />
          </button>
          <p
            aria-live="polite"
            aria-atomic="true"
            className="min-w-0 flex-1 text-center text-sm text-ink-muted"
          >
            <b className="font-semibold text-ink">{s.site}</b> ·{" "}
            {stepPosition(steps.index, steps.count)}
          </p>
          <button
            type="button"
            aria-label={STEP_NEXT}
            aria-disabled={last || undefined}
            onClick={() => !last && onStep?.(1)}
            className={STEP}
          >
            <Icon name="chevron" size={18} />
          </button>
        </div>
      )}
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
      <div className="rounded-row glass-tile px-4 py-3 text-sm tabular-nums">
        <p className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <b className="font-medium text-ink">{whenText(s, timeZone)}</b>
          <span className="text-ink-muted">
            {lengthAndPay(s.startsAt, s.endsAt, s.payRatePence)}
          </span>
        </p>
        <span
          aria-hidden="true"
          className="mt-2 block h-1.5 overflow-hidden rounded-full bg-raised"
        >
          <span
            className={`block h-full rounded-full ${s.urgent ? "bg-mark-urgent" : "bg-mark-open"}`}
            style={{ width: `${Math.round(share * 100)}%` }}
          />
        </span>
        <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-ink-muted">
          <span className={soon.soon ? "text-urgent-ink" : undefined}>Starts in {soon.text}</span>
          <span>{placesText(s.placesFree)}</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col rounded-row glass-tile px-4 py-3">
          <p className="flex items-center justify-between gap-2 text-sm text-ink-muted">
            Booked
            <span className={`${chip.base} ${s.urgent ? chip.urgent : chip.attention}`}>
              {s.urgent ? "Urgent" : "Open"}
            </span>
          </p>
          <span className="relative mx-auto mt-1">
            <Gauge booked={booked} headcount={s.headcount} urgent={s.urgent} />
            <b className="absolute inset-x-0 bottom-0 text-center font-stat text-2xl text-ink">
              {bookedText(booked, s.headcount)}
            </b>
          </span>
          <span className="text-center text-xs text-ink-faint">booked</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-row glass-tile px-4 py-3 text-center">
          <b data-takers="" className="mt-2 font-stat text-3xl text-ink">
            {takers ? takers.count : "–"}
          </b>
          <span className="text-xs text-ink-faint">
            {canTakeLine(takers ? takers.count : null, s.offers.sent)}
          </span>
          <span className={`${chip.base} ${chip.wait} mt-auto`}>{offeredText(s.offers.sent)}</span>
        </div>
      </div>
      <p
        className={`flex items-center gap-3 rounded-row px-4 py-3 text-sm glass-rim ${banner.tone === "amber" ? "bg-attention-soft text-attention-ink" : "bg-urgent-soft text-urgent-ink"}`}
      >
        <Icon name="urgent" size={18} />
        {warning ?? banner.text}
      </p>
      <div className="flex flex-wrap gap-2">
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
          <Icon name="send" size={17} />
          {offerButton(takers)}
        </Link>
        <Link
          href={`/office/shifts/${s.shiftId}`}
          className={`${btn.secondary} grow whitespace-nowrap`}
        >
          Open the session
        </Link>
      </div>
      {message && message.id === s.shiftId && (
        <p role="status" className="font-medium text-ink">
          {message.words}
        </p>
      )}
    </section>
  );
}

export function Board({
  board,
  view,
  tiles,
  cards = DEFAULT_CARDS,
}: {
  board: Pick<
    BoardData,
    | "show"
    | "now"
    | "timeZone"
    | "gaps"
    | "toMark"
    | "venues"
    | "takers"
    | "updates"
    | "whoWorked"
    | "comingUp"
    | "mine"
  >;
  view: BoardView; // what the board shows: every link keeps it
  tiles: string | null; // the street map's file (MAP_TILES_URL), or none
  cards?: readonly DashboardCard[]; // what the person chose under Customise (Phase 26.3)
}) {
  const { show, now, timeZone, gaps, toMark, venues, takers, updates, whoWorked } = board;
  const { comingUp, mine } = board;
  const { open, panel } = useOfferPanel();
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The session picked here (its id), and the page's own choice when it was picked.
  const [picked, setPicked] = useState<{ id: string; was: string | null } | null>(null);
  // The venue the street map last moved to for a pick (`seq`: each pick moves it, the same one too).
  const [moveTo, setMoveTo] = useState<{ siteId: string; seq: number } | null>(null);
  const g = gaps.ok ? gaps.data : null;
  // Every session with places to fill, soonest first (round 8's To offer: dash-4).
  const all = g
    ? [...g.toOffer.sessions, ...g.offered.sessions].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.shiftId.localeCompare(b.shiftId),
      )
    : [];
  // The one picked while the page is still loading it, or has (and while it's still on the board:
  // the page's data may have changed since), else the one the page chose (also after another way
  // there, as the table's links). Who can take it is the page's: until it has loaded it for the one
  // picked, the card says so.
  const pageChose = g?.chosen?.shiftId ?? null;
  const wanted = picked && (pageChose === picked.was || pageChose === picked.id) ? picked.id : null;
  const current = all.find((s) => wanted !== null && s.shiftId === wanted) ?? g?.chosen ?? null;
  const chosenTakers = takers?.ok && current && pageChose === current.shiftId ? takers.data : null;
  const steps = stepperAt(all, current);

  // The address with the session, as a page load in place (no new history entry, no jump to the
  // top): the server sends the card's who-can-take-it for it.
  const load = (shiftId: string) =>
    startTransition(() => router.replace(boardHref(view, shiftId), { scroll: false }));
  const moveMap = (siteId: string | null) => {
    if (siteId) setMoveTo((m) => ({ siteId, seq: (m?.seq ?? 0) + 1 }));
  };
  // Picking a session: the card shows it at once, then the page loads who can take it. A pin or a
  // row moves the street map to its venue (`move`); a row brings the card into view if it's off
  // the screen (`scroll`: on a phone the list is under it).
  const pick = (s: BoardSession, how: { move?: boolean; scroll?: boolean } = {}) => {
    setPicked({ id: s.shiftId, was: pageChose });
    if (how.move) moveMap(s.siteId);
    load(s.shiftId);
    if (!how.scroll) return;
    const card = document.querySelector("[data-chosen]");
    const box = card?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight))
      card?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
  };
  // A pin: its venue's first session in the view, soonest first. One the list doesn't hold (past
  // its first 50): the page's own choice from the address.
  const pickVenue = (v: MapVenue) => {
    const first = venueSessions(all, v.siteId)[0];
    if (first) return pick(first, { move: true });
    if (!v.firstShiftId) return;
    setPicked(null);
    moveMap(v.siteId);
    load(v.firstShiftId);
  };
  // The card's arrows: the venue's session before or after (the map stays where it is).
  const step = (by: -1 | 1) => {
    const s = current && stepTo(all, current, by);
    if (s) pick(s);
  };

  const total = g ? g.toOffer.total + g.offered.total : 0;
  const places = g ? g.toOffer.places + g.offered.places : 0;
  const waiting = g ? g.offered.waiting : 0;
  const viewAll =
    total > SHOWN
      ? {
          text: viewAllText(total),
          href: show === "urgent" ? "/office/events?view=urgent" : "/office/events?view=need",
        }
      : null;
  const ups = updates.ok ? updates.data : null;
  const marks = toMark.ok ? toMark.data : null;
  const groups = whoWorked.ok ? whoWorked.data : null;
  const soon = comingUp?.ok ? comingUp.data : null;
  const on = new Set(cards);
  const detail = (
    <DetailCard
      s={current}
      takers={current ? chosenTakers : null}
      show={show}
      now={now}
      timeZone={timeZone}
      failed={!gaps.ok}
      onOffer={open}
      steps={steps}
      onStep={step}
    />
  );
  // To offer as a list on the map while the map shows (Phase 27.4), else the column it was.
  const onMap = on.has("map") && venues.ok && on.has("toOffer");
  const toOffer = (float: boolean) => (
    <Column
      k="toOffer"
      count={total}
      line={toFillLine(places, waiting)}
      failed={!g}
      empty={emptyText("toOffer", true, show)}
      foot={viewAll}
      float={float}
    >
      <ul role="list" className="mt-3 flex flex-col gap-2">
        {(float ? all : all.slice(0, SHOWN)).map((s) => (
          <li key={s.shiftId}>
            <OfferRow
              s={s}
              picked={current?.shiftId === s.shiftId}
              view={view}
              timeZone={timeZone}
              onPick={(x) => pick(x, { move: true, scroll: true })}
              onOffer={open}
            />
          </li>
        ))}
      </ul>
    </Column>
  );
  const columns = (["toOffer", "updates", "comingUp", "whoWorked"] as const).filter(
    (k) => on.has(k) && !(k === "toOffer" && onMap),
  );

  return (
    <>
      {!on.has("map") ? (
        // Without the map, the session card on its own (it's where a session is offered).
        <div className="@min-[64rem]:w-101">{detail}</div>
      ) : venues.ok ? (
        <VenueMap
          venues={venues.data}
          chosenSite={current?.siteId ?? null}
          view={view}
          tiles={tiles}
          card={detail}
          list={onMap ? toOffer(true) : null}
          moveTo={moveTo}
          onPickVenue={pickVenue}
        />
      ) : (
        <section aria-label="Venues with places to fill" className="glass rounded-inner p-6">
          <SectionError />
        </section>
      )}
      {columns.length > 0 && (
        // One card a row on a phone; two across from 768px of page; three from 1152px when there
        // are three (with the map shown, To offer is on it: Updates and Coming up side by side);
        // four, two by two.
        <div
          className={`grid items-start gap-3 @min-[48rem]:grid-cols-2 ${columns.length === 3 ? "@min-[72rem]:grid-cols-3" : ""}`}
        >
          {columns.includes("toOffer") && toOffer(false)}
          {on.has("updates") && (
            <Column
              k="updates"
              count={ups?.items.length ?? 0}
              line={mine ? ON_YOUR_CONTRACTS : null}
              failed={!ups}
              empty={emptyText("updates", false, show)}
            >
              <UpdatesList items={ups?.items ?? []} now={now} timeZone={timeZone} onOffer={open} />
            </Column>
          )}
          {on.has("comingUp") && (
            <Column
              k="comingUp"
              count={soon?.total ?? 0}
              line={soon && soon.total > 0 ? comingUpLine(soon.people, soon.total, mine) : null}
              failed={!soon}
              empty={comingUpEmpty(mine)}
              foot={{ text: COMING_UP_ALL, href: COMING_UP_ALL_HREF }}
            >
              <ComingUpList
                sessions={soon?.sessions ?? []}
                now={now}
                timeZone={timeZone}
                onOffer={open}
              />
            </Column>
          )}
          {on.has("whoWorked") && (
            <Column
              k="toMark"
              count={marks?.items.length ?? 0}
              line={toMarkLine(
                marks?.items ?? [],
                (groups ?? []).reduce((n, g) => n + g.people.length, 0),
                timeZone,
              )}
              failed={!marks || !groups}
              empty={emptyText("toMark", false, show)}
            >
              <WhoWorkedList groups={groups ?? []} timeZone={timeZone} />
            </Column>
          )}
        </div>
      )}
      {panel}
    </>
  );
}
