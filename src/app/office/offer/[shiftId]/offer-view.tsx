import Link from "next/link";
import { card, h2, headingGap, muted, row, rows, sectionGap, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import type { OfferPage } from "@/lib/office/offer-page";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { DAILY_OFFER_CAP } from "@/lib/rules/offer-cap";
import { RESPONSE_TONE, WAITING_TONE } from "../../shifts/shift-tones";
import { OfferButton } from "./offer-button";

// The offer page's content (pure: the page loads the data). The header names the shift (a link
// to its page) and says how many places are free; then the people who can take it, one row each
// with its "Send offer" button, then who has already been offered it.

const RESPONSE: Record<NonNullable<OfferPage["offered"][number]["response"]>, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "didn't answer in time",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

export function OfferView({ page, eyebrow }: { page: OfferPage; eyebrow: string }) {
  const { shift, timeZone } = page;
  return (
    <>
      <PageHeader eyebrow={eyebrow} title="Offer this shift">
        <p className="text-lg font-semibold">
          <Link
            href={`/office/shifts/${shift.shiftId}`}
            className={`inline-flex min-h-11 items-center ${textLink}`}
          >
            {roleLabel(shift.role)}
            {shift.site ? ` at ${shift.site}` : ""}
          </Link>
        </p>
        <p className="tabular-nums">{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
        {shift.open && (
          <>
            <p>
              <StatusChip tone="attention">
                {shift.placesLeft === 1 ? "1 place free" : `${shift.placesLeft} places free`}
              </StatusChip>
            </p>
            {shift.isUrgent && (
              <p className="font-semibold text-urgent-ink">
                This shift is urgent: they get the urgent message.
              </p>
            )}
          </>
        )}
      </PageHeader>
      {shift.open && shift.hidden ? (
        <p className={`${card} text-ink-muted`}>
          This shift is hidden from casuals, so it can&apos;t be offered. Show it to casuals first,
          or assign someone from the shift&apos;s page.
        </p>
      ) : shift.open ? (
        <section aria-labelledby="who-can-take-it">
          <h2 id="who-can-take-it" className={h2}>
            Who can take it
          </h2>
          <p className={`${muted} mt-1 max-w-prose`}>
            Only people the rules allow, who want offers, and who haven&apos;t been offered it.
            Unless it&apos;s urgent, not anyone offered {DAILY_OFFER_CAP} shifts today.
          </p>
          {page.candidates.length === 0 ? (
            <p className={`${card} ${headingGap} text-ink-muted`}>
              Nobody else can be offered this shift right now.
            </p>
          ) : (
            <ul role="list" className={`${rows} ${headingGap}`}>
              {page.candidates.map((c) => (
                <li
                  key={c.workerId}
                  className={`${row} flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-ink-muted">
                      <span className="tabular-nums">
                        {c.hoursThisWeek === 1 ? "1 hour" : `${c.hoursThisWeek} hours`}
                      </span>{" "}
                      booked that week · by {c.channel === "sms" ? "text message" : "WhatsApp"}
                    </p>
                  </div>
                  <OfferButton shiftId={shift.shiftId} workerId={c.workerId} name={c.name} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className={`${card} text-ink-muted`}>This shift isn&apos;t open any more.</p>
      )}
      <section className={sectionGap.office} aria-labelledby="already-offered">
        <h2 id="already-offered" className={h2}>
          Already offered
        </h2>
        {page.offered.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>Nobody yet.</p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {page.offered.map((o, i) => (
              <li key={`${o.worker}-${i}`} className={`${row} leading-8`}>
                <span className="font-semibold">{o.worker}:</span>{" "}
                <StatusChip
                  tone={o.response ? (RESPONSE_TONE[o.response] ?? "quiet") : WAITING_TONE}
                >
                  {o.response ? RESPONSE[o.response] : "waiting"}
                </StatusChip>{" "}
                <span className="text-ink-muted">
                  ({o.wave === null ? "by the office" : `wave ${o.wave}`},{" "}
                  {timeOnDay(o.sentAt, timeZone)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
