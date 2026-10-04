import Link from "next/link";
import type { TodayShift, TodayView } from "@/lib/office/today";
import {
  placesText,
  requestsText,
  sheetChangeText,
  sheetNameText,
  stoppedText,
  toCheckText,
  toMarkText,
  waveText,
} from "@/lib/office/today-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { lineWords } from "@/lib/tenancy/shifts-line";
import { BookingToCheckActions } from "./keep-booking";
import { ShiftActions } from "./shift-actions";

// The office's Today view (docs/screens.md `/office/today`). Pure: the page loads the data.

// A message from a number we don't know shows its first 300 characters (the rest is stored).
const UNKNOWN_TEXT_MAX = 300;

const section = "mt-8";
const heading = "text-2xl font-bold";
const card = "mt-3 rounded-xl border border-slate-300 p-4";

function ShiftHeading({ shift, timeZone }: { shift: TodayShift; timeZone: string }) {
  return (
    <>
      <p className="text-lg font-semibold">
        <Link href={`/office/shifts/${shift.shiftId}`} className="underline">
          {roleLabel(shift.role)}
          {shift.site ? ` at ${shift.site}` : ""}
        </Link>
      </p>
      <p>{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</p>
      <p>{placesText(shift.placesLeft, shift.headcount)}</p>
    </>
  );
}

export function TodayContent({ view }: { view: Omit<TodayView, "officeUser"> }) {
  const tz = view.timeZone;
  return (
    <>
      <section className={section} aria-labelledby="urgent">
        <h2 id="urgent" className={heading}>
          Urgent shifts
        </h2>
        {view.urgent.length === 0 ? (
          <p className="mt-2">No urgent shifts.</p>
        ) : (
          view.urgent.map((u) => (
            <article key={u.shiftId} className={card}>
              <ShiftHeading shift={u} timeZone={tz} />
              <p className="mt-2">{waveText(u)}</p>
              {stoppedText(u) && <p>{stoppedText(u)}</p>}
              {u.escalated && <p>The office was emailed about it.</p>}
              <ShiftActions shiftId={u.shiftId} isUrgent fromSheet={u.fromSheet} />
            </article>
          ))
        )}
      </section>

      <section className={section} aria-labelledby="gaps">
        <h2 id="gaps" className={heading}>
          Gaps in the next 7 days
        </h2>
        {view.gaps.length === 0 ? (
          <p className="mt-2">No gaps in the next 7 days.</p>
        ) : (
          view.gaps.map((g) => (
            <article key={g.shiftId} className={card}>
              <ShiftHeading shift={g} timeZone={tz} />
              <ShiftActions shiftId={g.shiftId} isUrgent={false} fromSheet={g.fromSheet} />
            </article>
          ))
        )}
        {view.gapsMore && <p className="mt-2">Showing the first 50.</p>}
      </section>

      {view.toCheck.length > 0 && (
        <section className={section} aria-labelledby="to-check">
          <h2 id="to-check" className={heading}>
            Bookings to check
          </h2>
          <p className="mt-2">
            These people are booked, but can&apos;t work these shifts as things stand. Cancel the
            booking (they&apos;re told), or keep it.
          </p>
          <ul>
            {view.toCheck.map((b) => (
              <li key={`${b.shiftId}-${b.workerId}`} className={card}>
                <p className="font-semibold">{toCheckText(b)}</p>
                <p>
                  <Link href={`/office/shifts/${b.shiftId}`} className="underline">
                    {roleLabel(b.role)}
                    {b.site ? ` at ${b.site}` : ""}
                  </Link>
                  , {shiftWhen(b.startsAt, b.endsAt, tz)}
                </p>
                <Link href={`/office/workers/${b.workerId}`} className="underline">
                  {b.worker}&apos;s page
                </Link>
                <BookingToCheckActions shiftId={b.shiftId} workerId={b.workerId} name={b.worker} />
              </li>
            ))}
          </ul>
          {view.toCheckMore && <p className="mt-2">Showing the first 50.</p>}
        </section>
      )}

      {view.fromSheet.length > 0 && (
        <section className={section} aria-labelledby="from-sheet">
          <h2 id="from-sheet" className={heading}>
            From your rota sheet
          </h2>
          <p className="mt-2">Your rota sheet asks for these, but the app couldn&apos;t do them.</p>
          <ul>
            {view.fromSheet.map((i) => (
              <li key={i.shiftId} className={card}>
                <p className="text-lg font-semibold">
                  <Link href={`/office/shifts/${i.shiftId}`} className="underline">
                    {roleLabel(i.role)}
                    {i.site ? ` at ${i.site}` : ""}
                  </Link>
                </p>
                <p>{shiftWhen(i.startsAt, i.endsAt, tz)}</p>
                {i.change && <p className="mt-2">{sheetChangeText(i.change)}</p>}
                {i.names.map((n, k) => (
                  <p key={`${n.name}-${k}`} className="mt-2">
                    {sheetNameText(n)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {view.fromSheetMore && <p className="mt-2">Showing the first 50.</p>}
        </section>
      )}

      <section className={section} aria-labelledby="cancelled">
        <h2 id="cancelled" className={heading}>
          Cancelled in the last 24 hours
        </h2>
        {view.cancellations.length === 0 ? (
          <p className="mt-2">No cancellations in the last 24 hours.</p>
        ) : (
          <ul>
            {view.cancellations.map((c) => (
              <li key={c.assignmentId} className={card}>
                <p className="font-semibold">
                  {c.byFirm ? `The office cancelled ${c.worker}` : `${c.worker} cancelled`}
                </p>
                <p>
                  {roleLabel(c.role)}
                  {c.site ? ` at ${c.site}` : ""}, {shiftWhen(c.startsAt, c.endsAt, tz)}
                </p>
                <p>
                  {noticeText(c.noticeHours).replace(/^./, (ch) => ch.toUpperCase())}. Recorded at{" "}
                  {timeOnDay(c.cancelledAt, tz)}.
                </p>
                {c.reason && <p>Reason: {c.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="to-mark">
        <h2 id="to-mark" className={heading}>
          Who worked?
        </h2>
        {view.toMark.length === 0 ? (
          <p className="mt-2">Nothing to mark from the last 7 days.</p>
        ) : (
          <ul>
            {view.toMark.map((t) => (
              <li key={t.shiftId} className={card}>
                <p className="text-lg font-semibold">
                  <Link href={`/office/shifts/${t.shiftId}`} className="underline">
                    {roleLabel(t.role)}
                    {t.site ? ` at ${t.site}` : ""}
                  </Link>
                </p>
                <p>{shiftWhen(t.startsAt, t.endsAt, tz)}</p>
                <p>{toMarkText(t.unmarked)}</p>
              </li>
            ))}
          </ul>
        )}
        {view.toMarkMore && <p className="mt-2">Showing the first 50.</p>}
      </section>

      <section className={section} aria-labelledby="requests">
        <h2 id="requests" className={heading}>
          Requests
        </h2>
        <p className="mt-2">{requestsText(view.requests)}</p>
        <Link href="/office/requests" className="mt-1 inline-block underline">
          See requests
        </Link>
      </section>

      <section className={section} aria-labelledby="unknown">
        <h2 id="unknown" className={heading}>
          Messages from numbers we don&apos;t know
        </h2>
        {view.unknownMessages.length === 0 ? (
          <p className="mt-2">None in the last 7 days.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {view.unknownMessages.map((u) => (
              <li key={u.messageId} className="py-2">
                <p className="font-semibold">
                  {u.from ? lineWords(u.from) : "Number withheld"}
                  {u.formerWorker
                    ? ` (${u.formerWorker}${u.formerWorkerActive ? "" : ", not active"})`
                    : ""}{" "}
                  · {timeOnDay(u.receivedAt, view.timeZone)}
                  {u.channel === "voice" ? " · Voicemail" : u.channel === "sms" ? " · Text" : ""}
                </p>
                <p>
                  {u.text
                    ? `“${u.text.length > UNKNOWN_TEXT_MAX ? `${u.text.slice(0, UNKNOWN_TEXT_MAX)}…` : u.text}”`
                    : u.channel === "voice"
                      ? "(A voicemail we couldn't turn into text.)"
                      : "(A photo or file, with no text.)"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {view.unknownMore && <p className="mt-2">Showing the newest 50.</p>}
      </section>

      <section className={section} aria-labelledby="expiring">
        <h2 id="expiring" className={heading}>
          Credentials expiring this week
        </h2>
        {view.expiring.length === 0 ? (
          <p className="mt-2">Nothing expires in the next 7 days.</p>
        ) : (
          <ul className="mt-2 list-disc pl-6">
            {view.expiring.map((e, i) => (
              <li key={`${e.worker}-${e.credential}-${i}`}>
                {e.worker}: {e.credential}, expires {dayLabel(e.expiresOn)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
