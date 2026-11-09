import Link from "next/link";
import type { ReactNode } from "react";
import { isOnNow, mapLink, NO_RATE_UNDER_LABEL, roleLabel, siteAddress } from "@/lib/portal/format";
import { nextShiftLine } from "@/lib/portal/home-board";
import {
  CAN_TAKE_TILE,
  EMPTY_NONE,
  EMPTY_TITLE,
  emptyOnMap,
  NEXT_TITLE,
  nearestText,
  nextOfText,
  ON_NOW_TITLE,
  QUALS_TILE,
  qualsFigure,
  SEE_SHIFTS,
  urgentBadge,
} from "@/lib/portal/home-map-copy";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { dateParts, inDays, shiftLine, timeRange } from "@/lib/portal/sign-copy";
import { stillComingOpen } from "@/lib/portal/still-coming-copy";
import { CancelShift } from "./shifts/cancel-shift";
import { BringAndWear, Fact, factCard, PayLine, TravelFigures } from "./shifts/shift-parts";
import { StillComingCard } from "./shifts/still-coming-card";
import { chip, staffBtn, staffH2 } from "./ui/classes";
import { Bar } from "./home/home-card";
import { Icon } from "./ui/icons";
import { Plate } from "./ui/plate";
import { DateTile } from "./ui/sign";

// Her next shift as a pass (Phase 20; docs/screens.md `/`, `/shifts` and "The casual app, Phase
// 28", 28.7), on Home and on Booked. Phase 28 (28.7): one glass section 12px round, 16px inside its
// edges, with no band: how soon ("In 3 days", a tag) and the date in words, the time large, the
// role and the event; a faint line; then the place, its town and postcode and the gate on a clear
// glass plate (8px round), then Directions (the maps link, the main button) and Details (clear
// glass) side by side, and "Can't make it?" in red words under them. Details opens a card under the pass (the pass keeps its size and place) with the rest
// in label and value rows: getting there, where to report, what to bring and wear, the pay ("Ask the
// office" when the session has no rate), the instructions, then "Directions" and "Ask for a
// change". Details is a <details> whose summary is the button: it opens without JavaScript and in
// the offline copy, and the card under the pass
// shows while it's open (a `:has()` rule on the pass). "Can't make it?" and "Ask for a change" only
// before it starts. Server-rendered; only "Can't make it?" is a client component.
//
// Phase 28.14: from 24 hours before the start until the start, "Still coming?" (a client card,
// src/app/shifts/still-coming-card.tsx) takes the place of the lone "Can't make it?": its heading,
// "Yes, I'm coming" (clear glass: Directions stays the main button) or "You said you're coming
// (Fri 13:02)" (MyShift.stillComingAt, 28.2), then "Can't make it?" inside it. The card is online
// only (data-online-only), so the copy kept for no signal shows neither.

export function NextPass({
  shift,
  timeZone,
  now,
  heading = "hidden",
  fresh = false,
  extra,
}: {
  shift: MyShift;
  timeZone: string;
  now: Date;
  // Home: the pass speaks for itself (its heading for screen readers); Booked: shown above it.
  heading?: "hidden" | "shown";
  // Just taken (`?new=` on Booked): it moves into its place, marked "New".
  fresh?: boolean;
  // Home (Phase 30.1): a line under the role and the event (how soon, how long, the pay), with
  // its bar. Booked passes none.
  extra?: ReactNode;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const onNow = isOnNow(shift, now);
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  // What she can still do before it starts.
  const canAct = shift.status === "confirmed" && shift.startsAt.getTime() > now.getTime();
  // In the day before it: "Still coming?" (28.14).
  const askComing = canAct && stillComingOpen(shift, now);
  // "Can't make it?": under Directions and Details, or inside "Still coming?". Keyed by the
  // booking: after a cancellation the next shift moves into the pass with its own, empty cancel
  // state.
  const cancel = (
    <CancelShift
      key={shift.assignmentId}
      shiftId={shift.shiftId}
      opener="full"
      summary={{
        dow: day.dow,
        day: day.day,
        line: shiftLine(shift.role, shift.startsAt, shift.endsAt, timeZone),
      }}
    />
  );
  const event = shift.eventName ?? null;
  const place = shift.site?.name ?? null;
  const what = [roleLabel(shift.role), event].filter(Boolean).join(" · ");
  // Under the place, its town and postcode (the full address is in Details).
  const town = shift.site
    ? [shift.site.town, shift.site.postcode]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    <section aria-labelledby="next-heading" data-pass="" className="flex flex-col gap-3">
      {/* On Home the heading is for screen readers only, and nothing stands above the pass. */}
      {heading === "hidden" && !fresh ? (
        <h2 id="next-heading" className="sr-only">
          {onNow ? "On now" : "Your next shift"}
        </h2>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h2 id="next-heading" className={heading === "hidden" ? "sr-only" : staffH2}>
            {onNow ? "On now" : "Your next shift"}
          </h2>
          {fresh && <Plate tone="brand">New</Plate>}
        </div>
      )}
      <div className={`glass rounded-inner px-4 py-4 ${fresh ? "animate-move" : "animate-in"}`}>
        <div>
          <p className="flex items-center justify-between gap-3">
            <span className={`${chip.base} ${chip.soon}`}>
              {inDays(shift.startsAt, shift.endsAt, now, timeZone)}
            </span>{" "}
            <span className="min-w-0 truncate text-base text-ink-muted">{day.long}</span>
          </p>
          <p className="mt-3 font-sign text-4xl leading-tight text-ink">{t.range}</p>
          <p className="mt-1 text-lg font-medium text-ink">{what}</p>
          {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
          {extra}
        </div>
        {/* When above the line, where (and what she can do) under it: the band's work since 28.7. */}
        <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
          {(place || shift.post) && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {place && <p className="text-lg font-medium text-ink">{place}</p>}
                {town && <p className="text-base text-ink-muted">{town}</p>}
              </div>
              {shift.post && (
                // The gate: the pass's one larger plate, 16px so it can be read at a gate.
                <span className="glass-button shrink-0 rounded-row px-3 py-1.5 text-base font-medium text-ink">
                  {shift.post}
                </span>
              )}
            </div>
          )}
          <div className="grid auto-cols-fr grid-flow-col gap-2">
            {map && (
              <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtn.primary}>
                <Icon name="pin" size={22} />
                Directions
              </a>
            )}
            <DetailsToggle />
          </div>
          {canAct &&
            (askComing ? (
              <StillComingCard
                key={`coming-${shift.assignmentId}`}
                shiftId={shift.shiftId}
                saidAt={shift.stillComingAt ?? null}
                timeZone={timeZone}
                main={false}
                cancel={cancel}
              />
            ) : (
              cancel
            ))}
        </div>
      </div>
      <PassDetails
        shift={shift}
        timeZone={timeZone}
        map={map}
        canAct={canAct}
        place={place}
        address={address}
      />
    </section>
  );
}

// The rest, under the pass while Details is open (a `:has()` rule on the pass: [data-pass]).
function PassDetails({
  shift,
  timeZone,
  map,
  canAct,
  place,
  address,
}: {
  shift: MyShift;
  timeZone: string;
  map: string | null;
  canAct: boolean;
  place: string | null;
  address: string | null;
}) {
  return (
    <div
      id="pass-details"
      className={`${factCard} hidden animate-open [[data-pass]:has([data-pass-more][open])_&]:flex`}
    >
      {shift.travel && (
        <Fact label="Getting there, from your travel area">
          <TravelFigures travel={shift.travel} timeZone={timeZone} />
        </Fact>
      )}
      {(shift.meetingPoint || address || place) && (
        <Fact label={shift.meetingPoint ? "Report to" : "Where"}>
          {shift.meetingPoint && <p className="text-lg">{shift.meetingPoint}</p>}
          {(address || place) && (
            <p className={shift.meetingPoint ? "text-sm text-ink-muted" : "text-lg"}>
              {[place, address].filter(Boolean).join(", ")}
            </p>
          )}
        </Fact>
      )}
      {shift.uniform && (
        <Fact label="Bring and wear">
          <BringAndWear text={shift.uniform} />
        </Fact>
      )}
      {shift.payRatePence != null ? (
        <PayLine ratePence={shift.payRatePence} startsAt={shift.startsAt} endsAt={shift.endsAt} />
      ) : (
        <Fact label="Pay">
          <p className="text-lg">{NO_RATE_UNDER_LABEL}</p>
        </Fact>
      )}
      {shift.instructions && (
        <Fact label="Instructions">
          <p className="text-base whitespace-pre-line">{shift.instructions}</p>
        </Fact>
      )}
      {(map || canAct) && (
        <div className="flex flex-col gap-2 py-4">
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtn.primary}>
              <Icon name="pin" size={22} />
              Directions
            </a>
          )}
          {canAct && (
            <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtn.secondary}>
              Ask for a change
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// Details: a <details> whose summary is the button, so it opens without JavaScript and in the
// offline copy.
function DetailsToggle() {
  return (
    <details data-pass-more="" className="group">
      <summary
        aria-controls="pass-details"
        className={`${staffBtn.secondary} list-none group-open:bg-brand-soft group-open:text-brand-ink group-open:shadow-none group-open:inset-shadow-sunk [&::-webkit-details-marker]:hidden`}
      >
        <Icon name="info" size={22} className="group-open:hidden" />
        <Icon name="chevron" size={22} className="hidden -rotate-90 group-open:block" />
        <span className="group-open:hidden">Details</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>
    </details>
  );
}

// --- Phase 32 (32.2): the card over Home's street map ------------------------------------------
// docs/screens.md "## Phase 32"; Dylan's approved mock-up. Her next shift as the office dashboard's
// session card: raised glass (`glass-float`, what floats over the map), the date box, the role with
// how soon as the office's soft "soon" badge, the event, the gate and the place; the time tile (the
// day and the times, how long and the pay, the bar filling over the last 7 days, how soon); from
// 1024px her qualifications and shifts-you-can-take tiles (online only: their figures go stale);
// then Directions (lime, the main button) and Details side by side, and "Can't make it?" (or
// "Still coming?") under them; Details opens the rest inside the card, as the pass does. Everything
// she could see and do on the pass is here: the same parts (PassDetails, DetailsToggle, CancelShift,
// StillComingCard). In the copy kept for no signal the card shows without the map.

type ChipTone = "urgent" | "attention" | "wait" | "done" | "quiet";
export interface CardTiles {
  quals: { valid: number; all: number; badge: { words: string; tone: ChipTone } | null };
  canTake: { count: number; urgent: number };
}

const cardTile = "glass-tile flex flex-col items-start gap-1.5 rounded-row p-3";

export function MapPass({
  shift,
  timeZone,
  now,
  count,
  tiles,
}: {
  shift: MyShift;
  timeZone: string;
  now: Date;
  count: number; // her upcoming bookings ("1 of 3")
  tiles?: CardTiles | null;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const onNow = isOnNow(shift, now);
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  const canAct = shift.status === "confirmed" && shift.startsAt.getTime() > now.getTime();
  const askComing = canAct && stillComingOpen(shift, now);
  const cancel = (
    <CancelShift
      key={shift.assignmentId}
      shiftId={shift.shiftId}
      opener="full"
      summary={{
        dow: day.dow,
        day: day.day,
        line: shiftLine(shift.role, shift.startsAt, shift.endsAt, timeZone),
      }}
    />
  );
  const place = shift.site?.name ?? null;
  const where = [shift.eventName, [shift.post, place].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
  const line = nextShiftLine(shift, now);
  return (
    <section
      aria-labelledby="next-heading"
      data-pass=""
      data-map-card=""
      className="glass-float flex animate-in flex-col gap-3 rounded-inner p-4"
    >
      <div className="flex items-center justify-between gap-3 max-lg:sr-only lg:border-b lg:border-line lg:pb-3">
        <h2 id="next-heading" className="text-base font-semibold text-ink">
          {onNow ? ON_NOW_TITLE : NEXT_TITLE}
          {count > 1 && (
            <span className="font-normal text-ink-muted">{` · ${nextOfText(count)}`}</span>
          )}
        </h2>
      </div>
      <div className="flex items-start gap-3">
        <DateTile dow={day.dow} day={day.day} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-2xl leading-tight font-semibold tracking-heading text-ink">
              {roleLabel(shift.role)}
            </span>
            <span className={`${chip.base} ${chip.soon}`}>
              {inDays(shift.startsAt, shift.endsAt, now, timeZone)}
            </span>
          </p>
          {where && <p className="mt-1 text-base text-ink-muted">{where}</p>}
          {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
        </div>
      </div>
      <div data-next-line="" className={`${cardTile} items-stretch`}>
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <b className="font-sign text-lg font-semibold text-ink tabular-nums">
            <span className="max-lg:sr-only">{`${day.dow} ${day.day} ${day.month}, `}</span>
            {t.range}
          </b>
          <span className="text-base text-ink-muted tabular-nums">{line.facts}</span>
        </p>
        {line.startsIn && (
          <span data-online-only="" className="flex flex-col gap-1.5">
            <Bar fill={line.fill} tone="brand" />
            <span className="text-base text-ink-muted tabular-nums">{line.startsIn}</span>
          </span>
        )}
      </div>
      {tiles && (
        <div data-online-only="" data-card-tiles="" className="hidden grid-cols-2 gap-3 lg:grid">
          <Link href="/profile" className={`${cardTile} press hover:bg-active`}>
            <span className="text-sm text-ink-muted">{QUALS_TILE}</span>
            <span className="font-stat text-2xl text-ink">
              {qualsFigure(tiles.quals.valid, tiles.quals.all)}
            </span>
            {tiles.quals.badge && (
              <span className={`${chip.base} ${chip[tiles.quals.badge.tone]}`}>
                {tiles.quals.badge.words}
              </span>
            )}
          </Link>
          <Link href="/shifts/open" className={`${cardTile} press hover:bg-active`}>
            <span className="text-sm text-ink-muted">{CAN_TAKE_TILE}</span>
            <span className="font-stat text-2xl text-ink">{tiles.canTake.count}</span>
            {tiles.canTake.urgent > 0 && (
              <span className={`${chip.base} ${chip.urgent}`}>
                {urgentBadge(tiles.canTake.urgent)}
              </span>
            )}
          </Link>
        </div>
      )}
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {map && (
          <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtn.primary}>
            <Icon name="pin" size={22} />
            Directions
          </a>
        )}
        <DetailsToggle />
      </div>
      {canAct &&
        (askComing ? (
          <StillComingCard
            key={`coming-${shift.assignmentId}`}
            shiftId={shift.shiftId}
            saidAt={shift.stillComingAt ?? null}
            timeZone={timeZone}
            main={false}
            cancel={cancel}
          />
        ) : (
          cancel
        ))}
      <PassDetails
        shift={shift}
        timeZone={timeZone}
        map={map}
        canAct={canAct}
        place={place}
        address={address}
      />
    </section>
  );
}

// Nothing booked, over the map: the shift she can take nearest to her travel area (or the soonest),
// and "See shifts you can take" (lime). With none to take, the empty pass's own sentence.
export function MapEmptyPass({
  nearest,
  openCount,
  timeZone,
}: {
  nearest: { shift: OpenShift; by: "distance" | "time" } | null;
  openCount: number;
  timeZone: string;
}) {
  const s = nearest?.shift ?? null;
  return (
    <section
      aria-labelledby="next-heading"
      data-map-card=""
      data-empty-pass=""
      className="glass-float flex animate-in flex-col gap-3 rounded-inner p-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-13 shrink-0 items-center justify-center rounded-inner bg-hivis text-on-hivis"
        >
          <Icon name="shifts" size={26} />
        </span>
        <div className="min-w-0">
          <h2 id="next-heading" className={staffH2}>
            {EMPTY_TITLE}
          </h2>
          {openCount > 0 ? (
            <>
              <p data-online-only="" className="text-base text-ink-muted">
                {emptyOnMap(openCount)}
              </p>
              <p data-offline-only="" className="text-base text-ink-muted">
                {EMPTY_NONE}
              </p>
            </>
          ) : (
            <p className="text-base text-ink-muted">{EMPTY_NONE}</p>
          )}
        </div>
      </div>
      {s && nearest && (
        <Link
          href={`/shifts/${s.shiftId}`}
          data-online-only=""
          data-nearest=""
          className={`${cardTile} press items-stretch hover:bg-active`}
        >
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <b className="font-semibold text-ink">
              {nearestText(nearest.by, dateParts(s.startsAt, timeZone))}
            </b>
            <span className="text-base text-ink-muted tabular-nums">
              {timeRange(s.startsAt, s.endsAt, timeZone).range}
            </span>
          </span>
          <span className="text-base text-ink-muted">
            {[roleLabel(s.role), s.site?.name].filter(Boolean).join(" · ")}
          </span>
        </Link>
      )}
      <Link href="/shifts/open" className={staffBtn.primary}>
        {SEE_SHIFTS}
      </Link>
    </section>
  );
}
