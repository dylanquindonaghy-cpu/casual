import Link from "next/link";
import { card, h2, headingGap, muted, row, rows, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import type { OfferPage } from "@/lib/office/offer-page";
import {
  ALREADY_OFFERED,
  candidateLine,
  NOBODY_ELSE,
  NOBODY_LEFT_OUT,
  NOBODY_YET,
  NOT_OFFERED,
  notOfferedMore,
  notOfferedWhy,
  OUTSIDE_AREA,
  placesFreeText,
  reachLine,
  RESPONSE_WORDS,
  sentBy,
  URGENT_NOTE,
  WHO_CAN_TAKE_IT,
  whoRule,
} from "@/lib/office/offer-words";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { DAILY_OFFER_CAP } from "@/lib/rules/offer-cap";
import { RESPONSE_TONE, WAITING_TONE } from "../../shifts/shift-tones";
import { OfferButton } from "./offer-button";

// The offer page's content (pure: the page loads the data). The header names the shift (a link
// to its page) and says how many places are free; then the people who can take it, one row each
// with how the offer will reach them (Phase 26.9, off-1) and its "Send offer" button, beside them
// from 1024px who can't be offered it and why (off-2), then who has already been offered it.

export function OfferView({ page }: { page: OfferPage }) {
  const { shift, timeZone } = page;
  return (
    <>
      <PageHeader title="Offer this session">
        <p className="text-lg font-semibold">
          <Link
            href={`/office/shifts/${shift.shiftId}`}
            className={`press inline-flex min-h-11 items-center ${textLink}`}
          >
            {roleLabel(shift.role)}
            {shift.site ? ` at ${shift.site}` : ""}
          </Link>
        </p>
        <p className="tabular-nums">{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
        {shift.open && (
          <>
            <p>
              <StatusChip tone="attention">{placesFreeText(shift.placesLeft)}</StatusChip>
            </p>
            {shift.isUrgent && <p className="font-semibold text-urgent-ink">{URGENT_NOTE}</p>}
          </>
        )}
      </PageHeader>
      {shift.open && shift.hidden ? (
        <p className={`${card} text-ink-muted`}>
          This session is hidden from casuals, so it can&apos;t be offered. Show it to casuals
          first, or assign someone from the session&apos;s page.
        </p>
      ) : shift.open ? (
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-2">
          <section aria-labelledby="who-can-take-it">
            <h2 id="who-can-take-it" className={h2}>
              {WHO_CAN_TAKE_IT}
            </h2>
            <p className={`${muted} mt-1 max-w-prose`}>{whoRule(DAILY_OFFER_CAP)}</p>
            {page.candidates.length === 0 ? (
              <p className={`${card} ${headingGap} text-ink-muted`}>{NOBODY_ELSE}</p>
            ) : (
              <ul role="list" className={`${rows} ${headingGap}`}>
                {page.candidates.map((c) => (
                  <li
                    key={c.workerId}
                    className={`${row} flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-sm text-ink-muted tabular-nums">{candidateLine(c)}</p>
                      <p className="text-sm text-ink">{reachLine(c.reach)}</p>
                      {c.outsideArea && (
                        <p className="mt-1">
                          <StatusChip tone="attention">{OUTSIDE_AREA}</StatusChip>
                        </p>
                      )}
                    </div>
                    <OfferButton shiftId={shift.shiftId} workerId={c.workerId} name={c.name} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <NotOfferedList page={page} />
        </div>
      ) : (
        <p className={`${card} text-ink-muted`}>This session isn&apos;t open any more.</p>
      )}
      <section className={sectionGap.office} aria-labelledby="already-offered">
        <h2 id="already-offered" className={h2}>
          {ALREADY_OFFERED}
        </h2>
        {page.offered.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>{NOBODY_YET}</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {page.offered.map((o, i) => (
              <li key={`${o.worker}-${i}`} className={`${row} leading-8`}>
                <span className="font-semibold">{o.worker}:</span>{" "}
                <StatusChip
                  tone={o.response ? (RESPONSE_TONE[o.response] ?? "quiet") : WAITING_TONE}
                >
                  {o.response ? RESPONSE_WORDS[o.response] : "waiting"}
                </StatusChip>{" "}
                <span className="text-ink-muted">
                  ({sentBy(o.wave)}, {timeOnDay(o.sentAt, timeZone)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// "Not offered, and why" (off-2): each with one reason, by name; at most 20, then how many more.
export function NotOfferedList({
  page,
}: {
  page: Pick<OfferPage, "notOffered" | "notOfferedMore">;
}) {
  return (
    <section aria-labelledby="not-offered">
      <h2 id="not-offered" className={h2}>
        {NOT_OFFERED}
      </h2>
      {page.notOffered.length === 0 ? (
        <p className={`${card} ${headingGap} text-ink-muted`}>{NOBODY_LEFT_OUT}</p>
      ) : (
        <ul role="list" className={`${rows} ${headingGap}`}>
          {page.notOffered.map((n) => (
            <li
              key={n.workerId}
              className={`${row} flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1`}
            >
              <span className="font-semibold">{n.name}</span>
              <span className="text-sm text-ink-muted">
                {notOfferedWhy(n.why, DAILY_OFFER_CAP)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {page.notOfferedMore > 0 && (
        <p className={`${muted} mt-3`}>{notOfferedMore(page.notOfferedMore)}</p>
      )}
    </section>
  );
}
