import Link from "next/link";
import { mapLink, siteAddress } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import { CancelShift } from "./shifts/cancel-shift";
import { muted, staffBtn } from "./ui/classes";

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
      className="mb-6 rounded-xl border-2 border-attention bg-attention-soft p-4 text-attention-ink"
    >
      <p className="font-semibold">No signal.</p>
      <p>These are your shifts from {updated}. They may have changed.</p>
      <p>Taking or cancelling a shift needs signal.</p>
    </div>
  );
}

export const BOOKED_PATH = "/shifts";

// The Shifts tab's two lists: Open (`/shifts/open`) and Booked (`/shifts`), as a segmented switch.
export function ShiftsSwitch({ current }: { current: "open" | "booked" }) {
  return (
    <nav
      aria-label="Open or booked"
      className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-quiet-soft p-1"
    >
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
// raised white pill with bold words (and aria-current); the words sit directly in the link. The
// focus ring is drawn inside the pill.
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
      className={`flex min-h-11 items-center justify-center rounded-lg border px-3 text-center focus-visible:-outline-offset-4 ${
        current
          ? "border-line bg-card font-bold text-ink"
          : "border-transparent font-semibold text-ink-muted hover:text-ink"
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
        <div className="mt-3 rounded-xl bg-quiet-soft p-3 text-base">
          <h3 className="font-semibold">Instructions</h3>
          <p className="mt-1 whitespace-pre-line">{shift.instructions}</p>
        </div>
      )}
    </>
  );
}

// What the worker can still do about a confirmed booking before it starts: ask the office for a
// change (a time change or a swap), or cancel it. Once it has started, both are the office's.
// Cancelling is quiet red words under the change button: there, but not shouting.
export function ShiftActions({ shift, now }: { shift: MyShift; now: Date }) {
  if (shift.status !== "confirmed" || shift.startsAt.getTime() <= now.getTime()) return null;
  return (
    <div className="mt-3 flex flex-col gap-1">
      <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtn.secondary}>
        Ask for a change
      </Link>
      {/* Keyed by the booking: after a cancellation the list reloads and the next shift moves
          into this card; a fresh key means it starts with its own, empty cancel state. */}
      <CancelShift key={shift.assignmentId} shiftId={shift.shiftId} />
    </div>
  );
}
