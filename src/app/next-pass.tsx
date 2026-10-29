import Link from "next/link";
import { isOnNow, mapLink, roleLabel, siteAddress } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import { dateParts, inDays, shiftLine, timeRange } from "@/lib/portal/sign-copy";
import { CancelShift } from "./shifts/cancel-shift";
import { BringAndWear, Fact, factCard, PayLine, TravelFigures } from "./shifts/shift-parts";
import { staffBtn, staffH2 } from "./ui/classes";
import { Icon } from "./ui/icons";
import { Plate } from "./ui/plate";

// Her next shift as a pass (Phase 20; docs/screens.md `/` and `/shifts`), on Home and on Booked.
// Phase 24 (24.6, round 7 of the canvas): one glass card whose top is a warm translucent band with
// how soon ("In 3 days") and the date in words, the time large, the role and the event; under the
// band the place, its town and postcode and the gate on a glass plate, then Directions (the maps
// link, tinted glass) and Details (clear glass) side by side, and "Can't make it?" in red words
// under them. Details opens a card under the pass (the pass keeps its size and place) with the rest
// in label and value rows: getting there, where to report, what to bring and wear, the pay, the
// instructions, then "Open in maps" and "Ask for a change". Details is a <details> whose summary is
// the button: it opens without JavaScript and in the offline copy, and the card under the pass
// shows while it's open (a `:has()` rule on the pass). "Can't make it?" and "Ask for a change" only
// before it starts. Server-rendered; only "Can't make it?" is a client component.

export function NextPass({
  shift,
  timeZone,
  now,
  heading = "hidden",
  fresh = false,
}: {
  shift: MyShift;
  timeZone: string;
  now: Date;
  // Home: the pass speaks for itself (its heading for screen readers); Booked: shown above it.
  heading?: "hidden" | "shown";
  // Just taken (`?new=` on Booked): it moves into its place, marked "New".
  fresh?: boolean;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const onNow = isOnNow(shift, now);
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  // What she can still do before it starts.
  const canAct = shift.status === "confirmed" && shift.startsAt.getTime() > now.getTime();
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
      <div className="flex items-center justify-between gap-3">
        <h2 id="next-heading" className={heading === "hidden" ? "sr-only" : staffH2}>
          {onNow ? "On now" : "Your next shift"}
        </h2>
        {fresh && <Plate tone="brand">New</Plate>}
      </div>
      <div className={`glass overflow-hidden rounded-3xl ${fresh ? "animate-move" : "animate-in"}`}>
        <div className="glass-band px-5 pt-4.5 pb-5">
          <p className="flex items-center justify-between gap-3">
            <span className="glass-tile rounded-[10px] px-2.5 py-1 text-base font-medium text-ink">
              {inDays(shift.startsAt, shift.endsAt, now, timeZone)}
            </span>{" "}
            <span className="min-w-0 truncate text-base text-ink-muted">{day.long}</span>
          </p>
          <p className="mt-3 font-sign text-4xl leading-tight text-ink">{t.range}</p>
          <p className="mt-1 text-lg font-medium text-ink">{what}</p>
          {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
        </div>
        <div className="flex flex-col gap-4 px-5 pt-4 pb-4">
          {(place || shift.post) && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {place && <p className="text-lg font-medium text-ink">{place}</p>}
                {town && <p className="text-base text-ink-muted">{town}</p>}
              </div>
              {shift.post && (
                <span className="glass-tile shrink-0 rounded-[10px] px-3 py-1.5 text-base font-medium text-ink">
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
          </div>
          {canAct && (
            // Keyed by the booking: after a cancellation the next shift moves into the pass with
            // its own, empty cancel state.
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
          )}
        </div>
      </div>
      <div
        id="pass-details"
        className={`${factCard} hidden animate-open [[data-pass]:has([data-pass-more][open])_&]:flex`}
      >
        {shift.travel && (
          <Fact label="Getting there, from your home area">
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
        {shift.payRatePence != null && (
          <PayLine ratePence={shift.payRatePence} startsAt={shift.startsAt} endsAt={shift.endsAt} />
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
                Open in maps
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
    </section>
  );
}

// Nothing booked: the pass's outline, and the way to find a shift.
export function EmptyPass() {
  return (
    <section
      aria-labelledby="next-heading"
      className="flex animate-in flex-col items-center gap-2.5 glass rounded-3xl border-2 border-dashed border-line-strong px-5 py-7 text-center"
    >
      <span
        aria-hidden="true"
        className="block h-12 w-18 rounded-xl border-[1.5px] border-dashed border-line-strong bg-raised"
      />
      <h2 id="next-heading" className="mt-1 text-2xl font-semibold">
        No shifts booked
      </h2>
      <p className="max-w-72 text-base text-ink-muted">
        Take a shift and it shows up here as your pass, with the time and the gate.
      </p>
      <Link href="/shifts/open" className={`${staffBtn.primary} mt-1.5`}>
        Find a shift
      </Link>
    </section>
  );
}
