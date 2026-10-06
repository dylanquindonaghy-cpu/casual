import Link from "next/link";
import type { ReactNode } from "react";
import { roleLabel, shiftWhen, siteAddress, soonLabel, timeOnDay } from "@/lib/portal/format";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { ShiftActions, ShiftDetails } from "../../my-shifts-view";
import { muted, staffBtn } from "../../ui/classes";
import { PageHeader } from "../../ui/page-header";
import { StatusChip } from "../../ui/status-chip";
import { TakeShiftButton } from "../open/take-shift-button";
import { ReviewForm } from "./review-form";

// One shift's page (docs/screens.md, `/shifts/[id]`): the shift in the page header (day and
// times, role at site, address), then what the worker can do about it. When the rules say no,
// their reasons in plain English and "Ask the office to review".

function Header({
  shift,
  timeZone,
  eyebrow,
  children,
}: {
  shift: ShiftSummary;
  timeZone: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  const address = shift.site ? siteAddress(shift.site) : null;
  return (
    <PageHeader eyebrow={eyebrow} title={shiftWhen(shift.startsAt, shift.endsAt, timeZone)}>
      <p className="font-semibold">
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site.name}` : ""}
      </p>
      {address && <p className={muted}>{address}</p>}
      {children}
    </PageHeader>
  );
}

// A plain sentence about the shift, in a grey box.
const stateBox = "rounded-xl bg-quiet-soft p-4 font-semibold";

const openShiftsLink = (
  <Link href="/shifts/open" className={`${staffBtn.primary} mt-4`}>
    See open shifts
  </Link>
);

export function ShiftView({
  page,
  timeZone,
  now,
  eyebrow,
}: {
  page: ShiftPage;
  timeZone: string;
  now: Date;
  eyebrow?: string; // the firm's name above the heading
}) {
  switch (page.state) {
    case "missing":
      return (
        <>
          <PageHeader eyebrow={eyebrow} title="We can't find that shift.">
            <p>It may have been removed, or the link is wrong.</p>
          </PageHeader>
          {openShiftsLink}
        </>
      );
    case "booked":
      return (
        <>
          <PageHeader
            eyebrow={eyebrow}
            title={shiftWhen(page.shift.startsAt, page.shift.endsAt, timeZone)}
          >
            <p className="font-semibold">{roleLabel(page.shift.role)}</p>
            <p>
              <StatusChip tone="done">You&apos;re booked on this shift</StatusChip>
            </p>
          </PageHeader>
          <ShiftDetails shift={page.shift} />
          <ShiftActions shift={page.shift} now={now} />
        </>
      );
    case "open":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow}>
            <p className={muted}>
              {page.shift.placesLeft === 1
                ? "1 place left"
                : `${page.shift.placesLeft} places left`}
            </p>
          </Header>
          <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
        </>
      );
    case "held":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>
            Offered first to people with fewer hours that week. You can take it from{" "}
            {soonLabel(page.opensAt, now, timeZone)}.
          </p>
        </>
      );
    case "blocked":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <section
            aria-labelledby="why-heading"
            className="rounded-xl border-2 border-urgent bg-urgent-soft p-4 text-urgent-ink"
          >
            <h2 id="why-heading" className="text-xl font-bold">
              You can&apos;t take this shift:
            </h2>
            <ul className="mt-2 list-disc pl-5">
              {page.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </section>
          {page.review ? (
            <div role="status" className="mt-6">
              <p className="font-semibold">
                You asked the office to review this at {timeOnDay(page.review.askedAt, timeZone)}.
                Reference: {page.review.ref}.
              </p>
              <p className="mt-1">You can see it in My requests.</p>
              <Link href="/requests" className={`${staffBtn.secondary} mt-3`}>
                See my requests
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-6">If you think this is wrong, ask the office to review it.</p>
              <ReviewForm shiftId={page.shift.shiftId} />
            </>
          )}
        </>
      );
    case "filled":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift has been filled.</p>
          {openShiftsLink}
        </>
      );
    case "started":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift has already started.</p>
          {openShiftsLink}
        </>
      );
    case "cancelled":
      return (
        <>
          <Header shift={page.shift} timeZone={timeZone} eyebrow={eyebrow} />
          <p className={stateBox}>This shift was cancelled.</p>
          {openShiftsLink}
        </>
      );
  }
}
