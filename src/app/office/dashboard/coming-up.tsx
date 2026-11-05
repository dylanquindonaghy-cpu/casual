import Link from "next/link";
import { initials } from "@/lib/office/board-copy";
import type { ComingUpPerson, ComingUpSession } from "@/lib/office/coming-up";
import {
  askedChip,
  askedHref,
  askedLabel,
  bookedOf,
  casualHref,
  comingUpHeading,
  licenceChip,
  licenceWords,
  placesShort,
  sessionLabel,
} from "@/lib/office/coming-up-copy";
import { localDateOf } from "@/lib/time/zoned";
import { chip } from "../../ui/classes";

// The dashboard's Coming up (Phase 27.9; docs/screens.md "/office, round 8"): who's working on the
// person's contracts today and tomorrow, by session, in Who worked?'s and Updates' parts so it
// looks like the rest of round 8. Each session's line is a link to its page ("Today 19:00–01:00 ·
// CSAS officer · Northgate Demo Town Centre", "3 of 4 booked": red while a place is free on one
// that starts today); under it the people booked, A to Z, each their initials and their name (a
// link to their casual page), with a red chip where a licence the session needs won't be in date
// for it, and an amber one, a link to the request, where they've asked to change times or swap.
// What's flagged is the loader's (src/lib/office/coming-up.ts); this only shows it. No hooks: the
// server can draw it.

function Person({
  p,
  s,
  today,
  timeZone,
}: {
  p: ComingUpPerson;
  s: ComingUpSession;
  today: string;
  timeZone: string;
}) {
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
      {(p.licence || p.asked) && (
        <div className="flex flex-wrap items-center gap-x-2 pb-1 pl-12">
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
        </div>
      )}
    </li>
  );
}

export function ComingUpList({
  sessions,
  now,
  timeZone,
}: {
  sessions: ComingUpSession[];
  now: Date;
  timeZone: string;
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
            <ul role="list" className="flex flex-col divide-y divide-line">
              {s.people.map((p) => (
                <Person key={p.workerId} p={p} s={s} today={today} timeZone={timeZone} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
