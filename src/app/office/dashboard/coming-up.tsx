import Link from "next/link";
import { initials } from "@/lib/office/board-copy";
import type { ComingUpPerson, ComingUpSession } from "@/lib/office/coming-up";
import {
  askedChip,
  askedHref,
  askedLabel,
  bookedOf,
  casualHref,
  comingChip,
  comingUpHeading,
  comingWords,
  FIRST_SHIFT,
  firstShiftWords,
  licenceChip,
  licenceWords,
  NOT_ANSWERED,
  notAnsweredWords,
  offerPlaces,
  offerPlacesLabel,
  ON_WATCH_LIST,
  placesShort,
  sessionLabel,
  watchWords,
} from "@/lib/office/coming-up-copy";
import { localDateOf } from "@/lib/time/zoned";
import { btn, chip } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { OfferLink, type OpenOffer } from "./offer-panel";

// The dashboard's Coming up (Phase 27.9; docs/screens.md "/office, round 8"): who's working on the
// person's contracts today and tomorrow, by session, in Who worked?'s and Updates' parts so it
// looks like the rest of round 8. Each session's line is a link to its page ("Today 19:00–01:00 ·
// CSAS officer · Northgate Demo Town Centre", "3 of 4 booked": red while a place is free on one
// that starts today); under it the people booked, A to Z, each their initials and their name (a
// link to their casual page), with a red chip where a licence the session needs won't be in date
// for it, and an amber one, a link to the request, where they've asked to change times or swap.
// What's flagged is the loader's (src/lib/office/coming-up.ts); this only shows it.
//
// Phase 27.10 (Dylan, 2026-11-05: "more ctas and data here on the dash but keep it simple"): a
// session with places the office can offer now has "Offer 1 place" ("Offer 2 places") under "3 of
// 4 booked", opening the board's offer panel (a link to the offer page until the page is ready);
// and two more chips beside a person's others, in the same styles: an amber "On the watch list"
// (the Watch list card's own rule) and a grey "First shift" (nothing of theirs marked as worked
// before this session). No hooks of its own: it's drawn inside the board, whose panel it opens.
//
// Phase 28.14 ("Still coming?"): first in a person's chips, a green "Coming 13:02" where they said
// so in the day before, or a grey "Not answered yet" on a session starting within 24 hours (none
// for a booking the firm's own system reminds). The loader decides which; neither does anything.

function Person({
  p,
  s,
  today,
  now,
  timeZone,
}: {
  p: ComingUpPerson;
  s: ComingUpSession;
  today: string;
  now: Date;
  timeZone: string;
}) {
  const coming = p.stillComing;
  return (
    <li className="flex flex-col gap-1 py-1">
      <Link
        href={casualHref(p.workerId)}
        className="press flex min-h-11 items-center gap-3 rounded-row px-1 hover:bg-active"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink-muted"
        >
          {initials(p.name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.name}</span>
      </Link>
      {(coming || p.licence || p.asked || p.watch || p.firstShift) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-1 pl-12">
          {coming?.kind === "coming" && (
            <span
              data-still-coming="coming"
              className={`${chip.base} ${chip.done}`}
              title={comingWords(p.name, coming.at, timeZone)}
            >
              <span aria-hidden="true">{comingChip(coming.at, now, timeZone)}</span>
              <span className="sr-only">{comingWords(p.name, coming.at, timeZone)}</span>
            </span>
          )}
          {coming?.kind === "waiting" && (
            <span
              data-still-coming="waiting"
              className={`${chip.base} ${chip.quiet}`}
              title={notAnsweredWords(p.name)}
            >
              <span aria-hidden="true">{NOT_ANSWERED}</span>
              <span className="sr-only">{notAnsweredWords(p.name)}</span>
            </span>
          )}
          {p.licence && (
            <span
              className={`${chip.base} ${chip.urgent}`}
              title={licenceWords(p.name, p.licence, s, today, timeZone)}
            >
              <span aria-hidden="true">{licenceChip(p.licence, today)}</span>
              <span className="sr-only">{licenceWords(p.name, p.licence, s, today, timeZone)}</span>
            </span>
          )}
          {p.asked && (
            // The chip in a 44px tap target.
            <Link
              href={askedHref(p.asked.requestId)}
              aria-label={askedLabel(p.name, p.asked.type)}
              className="press inline-flex min-h-11 items-center rounded-full"
            >
              <span className={`${chip.base} ${chip.attention}`}>{askedChip(p.asked.type)}</span>
            </Link>
          )}
          {p.watch && (
            <span className={`${chip.base} ${chip.attention}`} title={watchWords(p.name)}>
              <span aria-hidden="true">{ON_WATCH_LIST}</span>
              <span className="sr-only">{watchWords(p.name)}</span>
            </span>
          )}
          {p.firstShift && (
            <span className={`${chip.base} ${chip.quiet}`} title={firstShiftWords(p.name)}>
              <span aria-hidden="true">{FIRST_SHIFT}</span>
              <span className="sr-only">{firstShiftWords(p.name)}</span>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function ComingUpList({
  sessions,
  now,
  timeZone,
  onOffer,
}: {
  sessions: ComingUpSession[];
  now: Date;
  timeZone: string;
  onOffer: OpenOffer; // the board's offer panel
}) {
  const today = localDateOf(now, timeZone);
  return (
    <ul role="list" className="mt-3 flex flex-col gap-3">
      {sessions.map((s) => {
        const heading = comingUpHeading(s, now, timeZone);
        const booked = bookedOf(s.booked, s.headcount);
        return (
          <li key={s.shiftId} data-coming-up={s.shiftId} className="flex flex-col">
            <Link
              href={`/office/shifts/${s.shiftId}`}
              aria-label={sessionLabel(heading, booked)}
              className="press flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-row px-1 text-xs text-ink-faint hover:text-ink"
            >
              <span className="min-w-0">{heading}</span>{" "}
              <span
                className={`whitespace-nowrap tabular-nums ${placesShort(s, now, timeZone) ? "font-semibold text-urgent-ink" : ""}`}
              >
                {booked}
              </span>
            </Link>
            {s.placesToOffer > 0 && (
              // Under "3 of 4 booked": what's still to offer, in the offer panel.
              <div className="flex justify-end pb-1">
                <OfferLink
                  shiftId={s.shiftId}
                  onOffer={onOffer}
                  label={offerPlacesLabel(s.placesToOffer, heading)}
                  className={btn.small}
                >
                  <Icon name="send" size={15} />
                  {offerPlaces(s.placesToOffer)}
                </OfferLink>
              </div>
            )}
            <ul role="list" className="flex flex-col divide-y divide-line">
              {s.people.map((p) => (
                <Person key={p.workerId} p={p} s={s} today={today} now={now} timeZone={timeZone} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
