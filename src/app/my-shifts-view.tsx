import Link from "next/link";
import { mapLink, siteAddress } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import { CancelShift } from "./shifts/cancel-shift";
import { dateParts, shiftLine } from "@/lib/portal/sign-copy";
import { muted, staffBtn, staffBtnSmall, switchTrack } from "./ui/classes";
import { Icon } from "./ui/icons";

// Pieces Home and Booked share (12H.1): the no-signal notice, the Shifts tab's Open | Booked switch,
// the segmented links, a booking's details and what she can do about it. Booked itself is
// src/app/shifts/booked-view.tsx; Home is src/app/home-view.tsx; the shift page uses the details
// too (src/app/shifts/[id]/shift-view.tsx).

// "No signal" (Home and Booked): shown only in the copy kept for when there's no signal:
// public/sw.js removes `hidden` when it serves that copy (so `hidden` stays before the classes). It
// carries the time the copy was made.
export function OfflineNotice({ updated }: { updated: string }) {
  return (
    <div
      data-offline-notice=""
      hidden
      suppressHydrationWarning
      role="status"
      className="glass flex items-start gap-3 rounded-2xl p-3.5 text-base"
    >
      <Icon name="offline" size={24} className="mt-px" />
      <div>
        <p className="text-lg font-semibold">No signal.</p>
        <p className="text-ink-muted">
          This is your saved copy from {updated}. It updates when you&apos;re back online.
        </p>
        <p className="text-ink-muted">Taking or cancelling a shift needs signal.</p>
      </div>
    </div>
  );
}

export const BOOKED_PATH = "/shifts";

// The Shifts tab's two lists: Open (`/shifts/open`) and Booked (`/shifts`), as a segmented switch.
export function ShiftsSwitch({ current }: { current: "open" | "booked" }) {
  return (
    <nav aria-label="Open or booked" className={`mb-4 ${switchTrack}`}>
      <Toggle href="/shifts/open" current={current === "open"}>
        Open
      </Toggle>
      <Toggle href={BOOKED_PATH} current={current === "booked"}>
        Booked
      </Toggle>
    </nav>
  );
}

// The Upcoming / Past 30 days switch: a segmented control, not a button. The current half is a
// white pill lifted out of the sunk track (Phase 20), with bold words (and aria-current); the
// words sit directly in the link. The focus ring is drawn inside the pill.
export function Toggle({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex min-h-11 items-center justify-center rounded-full px-3 text-center focus-visible:-outline-offset-4 ${
        current ? "lens font-semibold text-ink" : "font-medium text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

// Where and what to do: the site and its address, a maps button, the instructions.
export function ShiftDetails({ shift }: { shift: MyShift }) {
  const map = shift.site ? mapLink(shift.site) : null;
  const address = shift.site ? siteAddress(shift.site) : null;
  return (
    <>
      {shift.site && (
        <div className="mt-3">
          <p className="font-semibold">{shift.site.name}</p>
          {address && <p className={muted}>{address}</p>}
          {map && (
            <a
              href={map}
              target="_blank"
              rel="noopener noreferrer"
              className={`${staffBtn.secondary} mt-3`}
            >
              Open in maps
            </a>
          )}
        </div>
      )}
      {shift.instructions && (
        <div className="mt-3 rounded-2xl bg-quiet-soft p-3 text-base">
          <h3 className="font-semibold">Instructions</h3>
          <p className="mt-1 whitespace-pre-line">{shift.instructions}</p>
        </div>
      )}
    </>
  );
}

// What the worker can still do about a confirmed booking before it starts: ask the office for a
// change (a time change or a swap), or say she can't make it (the sheet that cancels it). Once it
// has started, both are the office's.
export function ShiftActions({
  shift,
  now,
  timeZone,
}: {
  shift: MyShift;
  now: Date;
  timeZone: string;
}) {
  if (shift.status !== "confirmed" || shift.startsAt.getTime() <= now.getTime()) return null;
  const day = dateParts(shift.startsAt, timeZone);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2.5">
      <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtnSmall}>
        Ask for a change
      </Link>
      {/* Keyed by the booking: after a cancellation the list reloads and the next shift moves
          into this card; a fresh key means it starts with its own, empty cancel state. */}
      <CancelShift
        key={shift.assignmentId}
        shiftId={shift.shiftId}
        opener="small"
        summary={{
          dow: day.dow,
          day: day.day,
          line: shiftLine(shift.role, shift.startsAt, shift.endsAt, timeZone),
        }}
      />
    </div>
  );
}
