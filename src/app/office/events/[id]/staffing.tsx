import Link from "next/link";
import type { EventStaffing, OpenPlace, StaffingSession } from "@/lib/office/event-staffing";
import {
  initialsOf,
  LEGEND,
  LEGEND_HINT,
  needsWords,
  NO_OPEN_PLACES,
  NO_SESSIONS_TO_COME,
  OPEN_FIELDS,
  OPEN_PLACES_TITLE,
  offeredWords,
  openPlacesLine,
  openTimes,
  openTitle,
  PICK_SOMEONE,
  roleLine,
  rolePlural,
  STAFFING_BOOKED,
  STAFFING_TITLE,
  startsInWords,
  TILE_WORDS,
  tileLabel,
  timeSpan,
  toFillChip,
  whyOpen,
  yesNo,
} from "@/lib/office/event-page-copy";
import { roleLabel } from "@/lib/portal/format";
import { btn } from "../../../ui/classes";
import { Icon } from "../../../ui/icons";
import { OfferBest } from "./event-actions";

// An event's Staffing tab (Phase 26.5, evt-3 to evt-6; the mock-up's event page): the staffing
// layout (booked of needed overall and per role, with a bar; then each role's places as tiles, its
// sessions in time order: booked with who, open dashed amber, urgent red) beside the open places
// (urgent first; the chosen one opened: what it needs, when it starts, how many were offered,
// whether casuals see it, why it's open, "Offer to the best 5" and "Pick someone"). A booked tile
// opens its session (where a booking is cancelled or moved, as today); an open one picks its open
// place. On a phone: tiles three across, then the open places.

function Bar({ booked, needed }: { booked: number; needed: number }) {
  const pct = needed === 0 ? 0 : Math.round((booked / needed) * 100);
  return (
    <span aria-hidden="true" className="mt-2 block h-1.5 w-full rounded-full bg-line">
      <span className="block h-1.5 rounded-full bg-attention" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Tile({
  session,
  place,
  chosen,
  eventHref,
  tz,
}: {
  session: StaffingSession;
  place: StaffingSession["places"][number];
  chosen: boolean;
  eventHref: string;
  tz: string;
}) {
  const time = timeSpan(session.startsAt, session.endsAt, tz);
  const label = tileLabel(place, session, tz);
  const base =
    "press flex min-h-16 flex-col justify-center gap-1 rounded-row px-3 py-2 text-left text-sm";
  if (place.worker) {
    return (
      <Link
        href={`/office/shifts/${session.shiftId}#places`}
        aria-label={label}
        data-place="booked"
        className={`${base} glass-tile hover:bg-button-hover`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink-muted @min-[36rem]:flex"
          >
            {initialsOf(place.worker.name)}
          </span>
          <span className="truncate font-medium text-ink">{place.worker.name}</span>
        </span>
        <span className="text-xs text-ink-faint tabular-nums">{time}</span>
      </Link>
    );
  }
  if (place.state === "closed") {
    return (
      <span
        data-place="closed"
        className={`${base} cursor-default border border-line text-ink-faint`}
      >
        <span className="font-semibold">{TILE_WORDS.closed}</span>
        <span className="text-xs tabular-nums">{time}</span>
      </span>
    );
  }
  const urgent = place.state === "urgent";
  return (
    <Link
      href={`${eventHref}?place=${session.shiftId}#open-places`}
      aria-label={label}
      aria-current={chosen ? "true" : undefined}
      data-place={place.state}
      className={`${base} ${
        urgent
          ? "border border-urgent-line bg-urgent-tile text-urgent-ink"
          : "border border-dashed border-attention-line text-attention-ink"
      } ${chosen ? "outline-2 outline-offset-2 outline-accent" : ""}`}
    >
      <span className="font-semibold">{TILE_WORDS[urgent ? "urgent" : "open"]}</span>
      <span className="text-xs tabular-nums opacity-80">{time}</span>
    </Link>
  );
}

function OpenCard({
  o,
  chosen,
  firstWave,
  now,
  tz,
  eventHref,
}: {
  o: OpenPlace;
  chosen: boolean;
  firstWave: number | null;
  now: Date;
  tz: string;
  eventHref: string;
}) {
  const name = `${roleLabel(o.role)}, ${openTimes(o, tz)}`;
  const head = (
    <span className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <b className="block font-semibold text-ink">{openTitle(o)}</b>
        <span className="block text-sm text-ink-muted tabular-nums">{openTimes(o, tz)}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
          o.urgent ? "bg-urgent-soft text-urgent-ink" : "bg-attention-soft text-attention-ink"
        }`}
      >
        {o.urgent ? LEGEND.urgent : LEGEND.open}
      </span>
    </span>
  );
  if (!chosen) {
    return (
      <li>
        <Link
          href={`${eventHref}?place=${o.shiftId}#open-places`}
          className="press flex flex-col gap-2 rounded-row glass-tile p-4 hover:bg-button-hover"
        >
          {head}
          <span className="flex flex-wrap gap-2 text-xs text-ink-muted">
            {o.requirements.map((q) => (
              <span key={q} className="rounded-full bg-raised px-2 py-1">
                {q}
              </span>
            ))}
            <span className="rounded-full bg-raised px-2 py-1">
              {offeredWords(o.offers)} offered
            </span>
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li data-open-chosen={o.shiftId} className="flex flex-col gap-4 rounded-row glass-tile p-4">
      {head}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-ink-faint">{OPEN_FIELDS.needs}</dt>
          <dd className="font-semibold text-ink">{needsWords(o)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{OPEN_FIELDS.startsIn}</dt>
          <dd className="font-semibold text-ink tabular-nums">{startsInWords(o.startsAt, now)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{OPEN_FIELDS.offered}</dt>
          <dd className="font-semibold text-ink tabular-nums">{offeredWords(o.offers)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{OPEN_FIELDS.showing}</dt>
          <dd className="font-semibold text-ink">{yesNo(o.showing)}</dd>
        </div>
      </dl>
      {o.lastCancel && (
        <p className="flex gap-2 rounded-row border border-attention-line bg-attention-soft p-3 text-sm text-attention-ink">
          <Icon name="notice" size={16} className="shrink-0" />
          <span>{whyOpen(o.lastCancel, tz)}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <OfferBest shiftId={o.shiftId} firstWave={firstWave} name={name} offering={o.offering} />
        <Link
          href={`/office/offer/${o.shiftId}`}
          aria-label={`${PICK_SOMEONE}: ${name}`}
          className={`${btn.secondary} flex-1`}
        >
          {PICK_SOMEONE}
        </Link>
      </div>
    </li>
  );
}

export function StaffingTab({
  staffing: st,
  eventId,
  chosenPlace,
  now,
  tz,
}: {
  staffing: EventStaffing;
  eventId: string;
  chosenPlace: string | null;
  now: Date;
  tz: string;
}) {
  const eventHref = `/office/events/${eventId}`;
  const chosen =
    st.open.find((o) => o.shiftId === chosenPlace)?.shiftId ?? st.open[0]?.shiftId ?? null;
  const toFill = st.open.reduce((n, o) => n + o.placesFree, 0);
  return (
    <div className="grid items-start gap-4 @min-[64rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section
        id="staffing-layout"
        aria-labelledby="staffing-title"
        className="glass flex flex-col gap-4 rounded-inner p-4"
      >
        <h2
          id="staffing-title"
          className="flex items-center gap-2 px-1 text-lg font-semibold text-ink"
        >
          <Icon name="dashboard" size={16} className="text-ink-muted" />
          {STAFFING_TITLE}
          {toFill > 0 && (
            <span className="rounded-full bg-urgent-soft px-2 py-1 text-xs font-semibold text-urgent-ink">
              {toFillChip(toFill)}
            </span>
          )}
        </h2>
        {st.sessions.length === 0 ? (
          <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">{NO_SESSIONS_TO_COME}</p>
        ) : (
          <>
            <ul
              role="list"
              className="grid grid-cols-1 divide-y divide-line border-y border-line @min-[36rem]:grid-cols-3 @min-[36rem]:divide-x @min-[36rem]:divide-y-0"
            >
              {[
                { key: "all", booked: st.booked, needed: st.needed, words: STAFFING_BOOKED },
                ...st.roles.map((r) => ({
                  key: r.role,
                  booked: r.booked,
                  needed: r.needed,
                  words: rolePlural(r.role).toLowerCase(),
                })),
              ].map((c) => (
                <li key={c.key} className="px-3 py-3">
                  <span className="text-sm text-ink-muted tabular-nums">
                    <b className="text-2xl font-semibold text-ink">{c.booked}</b> / {c.needed}{" "}
                    {c.words}
                  </span>
                  <Bar booked={c.booked} needed={c.needed} />
                </li>
              ))}
            </ul>
            {st.roles.map((r) => (
              <div key={r.role} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
                  <h3 className="font-semibold text-ink">{rolePlural(r.role)}</h3>
                  <p className="text-xs text-ink-faint">{roleLine(r, tz)}</p>
                </div>
                <ul
                  role="list"
                  className="grid grid-cols-3 gap-2 @min-[36rem]:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]"
                >
                  {st.sessions
                    .filter((s) => s.role === r.role)
                    .flatMap((s) =>
                      s.places.map((p) => (
                        <li key={`${s.shiftId}-${p.slot}`} className="contents">
                          <Tile
                            session={s}
                            place={p}
                            chosen={p.state !== "booked" && s.shiftId === chosen}
                            eventHref={eventHref}
                            tz={tz}
                          />
                        </li>
                      )),
                    )}
                </ul>
              </div>
            ))}
            <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-ink-muted">
              <span className="rounded-full bg-done-soft px-2 py-1 font-semibold text-done-ink">
                {LEGEND.booked}
              </span>
              <span className="rounded-full bg-attention-soft px-2 py-1 font-semibold text-attention-ink">
                {LEGEND.open}
              </span>
              <span className="rounded-full bg-urgent-soft px-2 py-1 font-semibold text-urgent-ink">
                {LEGEND.urgent}
              </span>
              <span>{LEGEND_HINT}</span>
            </p>
          </>
        )}
      </section>
      <section
        id="open-places"
        aria-labelledby="open-places-title"
        className="glass flex flex-col gap-4 rounded-inner p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2
            id="open-places-title"
            className="flex items-center gap-2 text-lg font-semibold text-ink"
          >
            <Icon name="shifts" size={16} className="text-ink-muted" />
            {OPEN_PLACES_TITLE}
          </h2>
          {st.open.length > 0 && (
            <p className="text-sm text-ink-muted tabular-nums">{openPlacesLine(st.open)}</p>
          )}
        </div>
        {st.open.length === 0 ? (
          <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">{NO_OPEN_PLACES}</p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {st.open.map((o) => (
              <OpenCard
                key={o.shiftId}
                o={o}
                chosen={o.shiftId === chosen}
                firstWave={st.firstWave}
                now={now}
                tz={tz}
                eventHref={eventHref}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
