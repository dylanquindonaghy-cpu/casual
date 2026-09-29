import type { OfferPage } from "@/lib/office/offer-page";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { DAILY_OFFER_CAP } from "@/lib/rules/offer-cap";
import { OfferButton } from "./offer-button";

// The offer page's content (pure: the page loads the data).

const RESPONSE: Record<NonNullable<OfferPage["offered"][number]["response"]>, string> = {
  accepted: "took it",
  declined: "said no",
  expired: "didn't answer in time",
  filled_elsewhere: "filled by someone else",
  failed: "couldn't be sent",
};

export function OfferView({ page }: { page: OfferPage }) {
  const { shift, timeZone } = page;
  return (
    <>
      <h1 className="text-3xl font-bold">Offer this shift</h1>
      <p className="mt-2 text-lg font-semibold">
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site}` : ""}
      </p>
      <p>{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
      {shift.open ? (
        <>
          <p>{shift.placesLeft === 1 ? "1 place free" : `${shift.placesLeft} places free`}</p>
          {shift.isUrgent && (
            <p className="mt-2">This shift is urgent: they get the urgent message.</p>
          )}
          <h2 className="mt-6 text-2xl font-bold">Who can take it</h2>
          <p className="mt-1">
            Only people the rules allow, who want offers, and who haven&apos;t been offered it.
            Unless it&apos;s urgent, not anyone offered {DAILY_OFFER_CAP} shifts today.
          </p>
          {page.candidates.length === 0 ? (
            <p className="mt-3">Nobody else can be offered this shift right now.</p>
          ) : (
            <ul>
              {page.candidates.map((c) => (
                <li
                  key={c.workerId}
                  className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-300 p-3"
                >
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p>
                      {c.hoursThisWeek === 1 ? "1 hour" : `${c.hoursThisWeek} hours`} booked that
                      week · by {c.channel === "sms" ? "text message" : "WhatsApp"}
                    </p>
                  </div>
                  <OfferButton shiftId={shift.shiftId} workerId={c.workerId} name={c.name} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-3">This shift isn&apos;t open any more.</p>
      )}
      <h2 className="mt-6 text-2xl font-bold">Already offered</h2>
      {page.offered.length === 0 ? (
        <p className="mt-1">Nobody yet.</p>
      ) : (
        <ul className="mt-1 list-disc pl-6">
          {page.offered.map((o, i) => (
            <li key={`${o.worker}-${i}`}>
              {o.worker}: {o.response ? RESPONSE[o.response] : "waiting"} (
              {o.wave === null ? "by the office" : `wave ${o.wave}`},{" "}
              {timeOnDay(o.sentAt, timeZone)})
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
