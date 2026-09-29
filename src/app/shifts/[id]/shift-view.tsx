import Link from "next/link";
import { roleLabel, shiftWhen, siteAddress, soonLabel } from "@/lib/portal/format";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf, wallTimeOf } from "@/lib/time/zoned";
import { ShiftActions, ShiftDetails } from "../../my-shifts-view";
import { TakeShiftButton } from "../open/take-shift-button";
import { ReviewForm } from "./review-form";

// One shift's page (docs/screens.md, `/shifts/[id]`): the shift, then what the worker can do
// about it. When the rules say no, their reasons in plain English and "Ask the office to review".

const pad = (n: number) => String(n).padStart(2, "0");
const at = (instant: Date, timeZone: string) => {
  const w = wallTimeOf(instant, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(localDateOf(instant, timeZone))}`;
};

function Heading({ shift, timeZone }: { shift: ShiftSummary; timeZone: string }) {
  const address = shift.site ? siteAddress(shift.site) : null;
  return (
    <>
      <h1 className="text-2xl font-bold">{shiftWhen(shift.startsAt, shift.endsAt, timeZone)}</h1>
      <p className="mt-1">
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site.name}` : ""}
      </p>
      {address && <p className="text-base text-slate-700">{address}</p>}
    </>
  );
}

const openShiftsLink = (
  <Link
    href="/shifts/open"
    className="mt-4 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
  >
    See open shifts
  </Link>
);

export function ShiftView({
  page,
  timeZone,
  now,
}: {
  page: ShiftPage;
  timeZone: string;
  now: Date;
}) {
  switch (page.state) {
    case "missing":
      return (
        <>
          <h1 className="text-2xl font-bold">We can&apos;t find that shift.</h1>
          <p className="mt-2">It may have been removed, or the link is wrong.</p>
          {openShiftsLink}
        </>
      );
    case "booked":
      return (
        <>
          <p className="text-base font-semibold text-slate-600">You&apos;re booked on this shift</p>
          <h1 className="text-2xl font-bold">
            {shiftWhen(page.shift.startsAt, page.shift.endsAt, timeZone)}
          </h1>
          <p className="mt-1">{roleLabel(page.shift.role)}</p>
          <ShiftDetails shift={page.shift} />
          <ShiftActions shift={page.shift} now={now} />
        </>
      );
    case "open":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <p className="mt-2 text-base">
            {page.shift.placesLeft === 1 ? "1 place left" : `${page.shift.placesLeft} places left`}
          </p>
          <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
        </>
      );
    case "held":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <p className="mt-4 font-semibold">
            Offered first to people with fewer hours this week. You can take it from{" "}
            {soonLabel(page.opensAt, now, timeZone)}.
          </p>
        </>
      );
    case "blocked":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <section
            aria-labelledby="why-heading"
            className="mt-4 rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-900"
          >
            <h2 id="why-heading" className="text-xl font-semibold">
              You can&apos;t take this shift:
            </h2>
            <ul className="mt-2 list-disc pl-5">
              {page.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </section>
          {page.review ? (
            <div role="status" className="mt-4">
              <p className="font-semibold">
                You asked the office to review this at {at(page.review.askedAt, timeZone)}.
                Reference: {page.review.ref}.
              </p>
              <p className="mt-1">You can see it in My requests.</p>
              <Link
                href="/requests"
                className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center font-semibold"
              >
                See my requests
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-4">If you think this is wrong, ask the office to review it.</p>
              <ReviewForm shiftId={page.shift.shiftId} />
            </>
          )}
        </>
      );
    case "filled":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <p className="mt-4 font-semibold">This shift has been filled.</p>
          {openShiftsLink}
        </>
      );
    case "started":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <p className="mt-4 font-semibold">This shift has already started.</p>
          {openShiftsLink}
        </>
      );
    case "cancelled":
      return (
        <>
          <Heading shift={page.shift} timeZone={timeZone} />
          <p className="mt-4 font-semibold">This shift was cancelled.</p>
          {openShiftsLink}
        </>
      );
  }
}
