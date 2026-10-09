import Link from "next/link";
import type { NeedsItem } from "@/lib/credentials/status";
import type { FirmVoice } from "@/lib/messaging/templates";
import {
  isOnNow,
  mapLink,
  roleLabel,
  shiftWhen,
  siteAddress,
  timeOnDay,
} from "@/lib/portal/format";
import type { MyShift, ShiftsView } from "@/lib/portal/my-shifts";
import { needsText } from "@/lib/portal/qualification-copy";
import { travelLineText } from "@/lib/travel/line-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import { HomeScreenHint } from "./home-screen-hint";
import { CancelShift } from "./shifts/cancel-shift";
import { count, h2, headingGap, muted, row, rows, sectionGap, staffBtn } from "./ui/classes";
import { PageHeader } from "./ui/page-header";
import { StatusChip, type StatusTone } from "./ui/status-chip";

// My shifts (docs/screens.md, `/`; layout in docs/ui-design.md "Staff pages"): the greeting, then
// anything to act on (urgent shifts; "Needs updating": qualifications in their four levels, 12F.1),
// a switch between Upcoming and the last 30 days, the
// next shift in a card (time, role, site, map link, instructions, then what you can do), the rest
// in a list where each opens to the same details, and the way to every other page. Each upcoming
// shift shows its travel line ("7.2 miles · 18 min by car · …": 12G.3). Server-rendered
// HTML (the list opens with <details>); only "Cancel this shift" and the home screen hint are small
// client components.

export interface MyShiftsViewProps {
  firstName: string;
  voice: FirmVoice;
  timeZone: string;
  now: Date;
  view: ShiftsView;
  shifts: MyShift[];
  needs: NeedsItem[]; // qualifications to sort out, in order (src/lib/credentials/status.ts)
  urgentCount?: number; // urgent shifts this worker could take (the urgent board)
}

// A plain grey box for "nothing here" sentences.
const emptyBox = "mt-6 rounded-xl bg-quiet-soft p-4 text-ink";

export function MyShiftsView(props: MyShiftsViewProps) {
  const { firstName, voice, view, shifts, now, timeZone } = props;
  const updated = timeOnDay(now, timeZone);
  return (
    <>
      <PageHeader eyebrow={voice.name} title={`Hello ${firstName}`}>
        <p className={muted}>Updated {updated}</p>
      </PageHeader>
      {/* Shown only in the copy kept for when there's no signal: public/sw.js removes `hidden`
          when it serves that copy (so `hidden` stays before the classes). It carries the time the
          copy was made. */}
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
      {!!props.urgentCount && (
        <section
          aria-labelledby="urgent-heading"
          className="mb-6 rounded-xl border-2 border-urgent bg-urgent-soft p-4"
        >
          <h2 id="urgent-heading" className="text-lg font-bold text-urgent-ink">
            {props.urgentCount === 1
              ? "1 urgent shift needs someone"
              : `${props.urgentCount} urgent shifts need someone`}
          </h2>
          <Link href="/urgent" className={`${staffBtn.primary} mt-3`}>
            See urgent shifts
          </Link>
        </section>
      )}
      <NeedsUpdating {...props} />
      <nav
        aria-label="Which shifts"
        className="grid grid-cols-2 divide-x-2 divide-line-strong overflow-hidden rounded-xl border-2 border-line-strong"
      >
        <Toggle href="/" current={view === "upcoming"}>
          Upcoming
        </Toggle>
        <Toggle href="/?view=past" current={view === "past"}>
          Past 30 days
        </Toggle>
      </nav>
      {view === "upcoming" ? (
        <Upcoming {...props} />
      ) : shifts.length === 0 ? (
        <p className={emptyBox}>No shifts in the last 30 days.</p>
      ) : (
        <section aria-labelledby="past-heading" className="mt-6">
          <h2 id="past-heading" className={h2}>
            The last 30 days
          </h2>
          <ul role="list" className={`${rows} ${headingGap}`}>
            {shifts.map((s) => (
              <ShiftRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
      <HomeScreenHint />
      <Pages first={view === "upcoming" && shifts.length === 0 ? "primary" : "secondary"} />
    </>
  );
}

// The Upcoming / Past 30 days switch: a segmented control, not a button. The current half is
// shaded, bold and underlined (and aria-current); the words sit directly in the link. The focus
// ring is drawn inside, as the rounded frame clips anything outside.
function Toggle({ href, current, children }: { href: string; current: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex min-h-12 items-center justify-center border-b-4 px-3 text-center focus-visible:-outline-offset-4 ${
        current
          ? "border-b-ink bg-quiet-soft font-bold text-ink"
          : "border-b-transparent font-semibold text-ink-muted hover:bg-quiet-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

// Every other page, always in the same place and in the same order. "See open shifts" is always
// here (once), and is the main button when nothing is booked. It's the last list on the page
// (tests/unit/portal.my-shifts.test.ts reads it from there). The lists here have no bullets, so
// each has role="list": Safari stops announcing a list once its bullets are styled away.
const PAGES: [href: string, words: string][] = [
  ["/shifts/open", "See open shifts"],
  ["/requests", "My requests"],
  ["/pay", "See your pay"],
  ["/profile", "My profile"],
  ["/help", "Help"],
];

function Pages({ first }: { first: "primary" | "secondary" }) {
  return (
    <ul role="list" className="mt-8 flex flex-col gap-3 border-t border-line pt-8">
      {PAGES.map(([href, words], i) => (
        <li key={href}>
          <Link href={href} className={i === 0 ? staffBtn[first] : staffBtn.secondary}>
            {words}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// "Needs updating" (docs/office-v2.md 4.2), shown only when something does: one row per
// qualification, the one that stops a booked shift first. A row that stops her working is red.
function NeedsUpdating({ needs, timeZone, now }: MyShiftsViewProps) {
  if (needs.length === 0) return null;
  const year = wallTimeOf(now, timeZone).year;
  const urgent = needs.some((n) => n.level <= 2);
  return (
    <section
      aria-labelledby="needs-heading"
      className={`mb-6 rounded-xl border-2 p-4 ${
        urgent
          ? "border-urgent bg-urgent-soft text-urgent-ink"
          : "border-attention bg-attention-soft text-attention-ink"
      }`}
    >
      <h2 id="needs-heading" className="text-lg font-bold">
        Needs updating
      </h2>
      <ul role="list" className="mt-2 flex flex-col gap-2 text-base">
        {needs.map((n) => (
          <li key={n.qualification.type}>{needsText(n, year)}</li>
        ))}
      </ul>
      <Link href="/profile" className={`${staffBtn.secondary} mt-3`}>
        See your qualifications
      </Link>
    </section>
  );
}

function Upcoming(props: MyShiftsViewProps) {
  const [next, ...later] = props.shifts;
  if (!next) return <p className={emptyBox}>No shifts booked yet.</p>;
  return (
    <>
      <NextShift shift={next} {...props} />
      {later.length > 0 && (
        <section aria-labelledby="later-heading" className={sectionGap.staff}>
          {/* The count sits beside the <h2>, not in it, so the section's name stays "Coming up"
              (as on the office pages). */}
          <div className="flex items-center">
            <h2 id="later-heading" className={h2}>
              Coming up
            </h2>
            <span className={count}>{later.length}</span>
          </div>
          <ul role="list" className={`${rows} ${headingGap}`}>
            {later.map((s) => (
              <UpcomingRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function NextShift({ shift, timeZone, now }: MyShiftsViewProps & { shift: MyShift }) {
  return (
    <section
      aria-labelledby="next-heading"
      className="mt-6 rounded-2xl border-2 border-ink bg-card p-4"
    >
      <h2 id="next-heading" className="text-base font-semibold text-ink-muted">
        {isOnNow(shift, now) ? "On now" : "Your next shift"}
      </h2>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
        {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
      </p>
      <p className="mt-1 font-semibold">{roleLabel(shift.role)}</p>
      <TravelLine shift={shift} timeZone={timeZone} />
      <ShiftDetails shift={shift} />
      <ShiftActions shift={shift} now={now} />
    </section>
  );
}

// Getting there: the shift's travel line (upcoming bookings carry it).
function TravelLine({ shift, timeZone }: { shift: MyShift; timeZone: string }) {
  if (!shift.travel) return null;
  return (
    <span className={`block ${muted}`} data-travel-line="">
      {travelLineText(shift.travel, timeZone)}
    </span>
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
        <div className="mt-4 rounded-xl bg-quiet-soft p-4">
          <h3 className="font-semibold">Instructions</h3>
          <p className="mt-1 whitespace-pre-line">{shift.instructions}</p>
        </div>
      )}
    </>
  );
}

// What the worker can still do about a confirmed booking before it starts: ask the office for a
// change (a time change or a swap), or cancel it. Once it has started, both are the office's.
// Set apart from the details by a line; cancelling looks destructive.
export function ShiftActions({ shift, now }: { shift: MyShift; now: Date }) {
  if (shift.status !== "confirmed" || shift.startsAt.getTime() <= now.getTime()) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtn.secondary}>
        Ask for a change
      </Link>
      {/* Keyed by the booking: after a cancellation the list reloads and the next shift moves
          into this card; a fresh key means it starts with its own, empty cancel state. */}
      <CancelShift key={shift.assignmentId} shiftId={shift.shiftId} />
    </div>
  );
}

// An upcoming shift in the list: tap it to open the same details as the next shift's card. The
// arrow turns when it's open.
function UpcomingRow({ shift, timeZone, now }: MyShiftsViewProps & { shift: MyShift }) {
  return (
    <li className="px-4">
      <details>
        <summary className="flex min-h-14 list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold tabular-nums">
              {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
            </span>
            <span className="block text-base text-ink-muted">
              {roleLabel(shift.role)}
              {shift.site ? ` at ${shift.site.name}` : ""}
            </span>
            <TravelLine shift={shift} timeZone={timeZone} />
            {isOnNow(shift, now) && <span className="block text-base font-semibold">On now</span>}
          </span>
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-ink-muted [details[open]_&]:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="pb-4">
          <ShiftDetails shift={shift} />
          {!shift.site && !shift.instructions && (
            <p className={`mt-1 ${muted}`}>No site or instructions yet.</p>
          )}
          <ShiftActions shift={shift} now={now} />
        </div>
      </details>
    </li>
  );
}

// What happened to a shift in the last 30 days, as a status word in its colour.
const PAST_LABELS: Record<MyShift["status"], [words: string, tone: StatusTone]> = {
  confirmed: ["Booked", "done"],
  completed: ["Worked", "done"],
  no_show: ["Marked as not attended", "urgent"],
};

// A shift in the last 30 days, with what happened.
function ShiftRow({ shift, timeZone }: MyShiftsViewProps & { shift: MyShift }) {
  const [words, tone] = PAST_LABELS[shift.status];
  return (
    <li className={row}>
      <p className="font-semibold tabular-nums">
        {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
      </p>
      <p className={muted}>
        {roleLabel(shift.role)}
        {shift.site ? ` at ${shift.site.name}` : ""}
      </p>
      <p className="mt-2">
        <StatusChip tone={tone}>{words}</StatusChip>
      </p>
    </li>
  );
}
