import Link from "next/link";
import { isOnNow, roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { dateParts, timeRange } from "@/lib/portal/sign-copy";
import { NextPass } from "../next-pass";
import type { MyShift, ShiftsView } from "@/lib/portal/my-shifts";
import { travelLineText } from "@/lib/travel/line-copy";
import {
  BOOKED_PATH,
  OfflineNotice,
  ShiftActions,
  ShiftDetails,
  ShiftsSwitch,
  Toggle,
} from "../my-shifts-view";
import {
  staffCount,
  staffH2,
  headingGap,
  muted,
  sectionGap,
  staffBtn,
  staffRow,
  staffRows,
  switchTrack,
} from "../ui/classes";
import { Icon } from "../ui/icons";
import { PageHeader } from "../ui/page-header";
import { Plate } from "../ui/plate";
import { DateTile } from "../ui/sign";
import { StatusChip, type StatusTone } from "../ui/status-chip";

// Booked (docs/office-v2.md 4.1, 4.3; docs/screens.md `/shifts`; 12H.1; Phase 20): her bookings,
// on the Shifts tab next to Open. A switch between Upcoming and the last 30 days (`?view=past`),
// the next shift as the same pass as Home's, with the same three buttons under it
// (src/app/next-pass.tsx), then "Later": the rest in a list where each opens to its details, or,
// with nothing else booked, a card that says so with "Find open shifts". Each later shift shows its
// travel line ("7.2 miles · 18 min by car · …": 12G.3). Kept for when there's no signal, like Home
// (public/sw.js), with the same notice. Server-rendered HTML (the list opens with <details>); only
// "Can't make it?" is a small client component.

export interface BookedViewProps {
  firmName: string;
  timeZone: string;
  now: Date;
  view: ShiftsView;
  shifts: MyShift[];
  // The shift she has just taken (`?new=`, from "See my shifts" after "Take shift"): it moves into
  // its place marked "New" (Phase 18's motion).
  newShiftId?: string;
}

// A plain card for "nothing here" sentences.
const emptyBox = "glass mt-6 rounded-3xl p-4.5 text-lg text-ink";

export function BookedView(props: BookedViewProps) {
  const { view, shifts, now, timeZone } = props;
  const updated = timeOnDay(now, timeZone);
  return (
    <>
      <PageHeader title="Booked shifts">
        <p className={muted}>Updated {updated}</p>
      </PageHeader>
      <OfflineNotice updated={updated} />
      <ShiftsSwitch current="booked" />
      <nav aria-label="Which shifts" className={switchTrack}>
        <Toggle href={BOOKED_PATH} current={view === "upcoming"}>
          Upcoming
        </Toggle>
        <Toggle href={`${BOOKED_PATH}?view=past`} current={view === "past"}>
          Past 30 days
        </Toggle>
      </nav>
      {view === "upcoming" ? (
        <Upcoming {...props} />
      ) : shifts.length === 0 ? (
        <p className={emptyBox}>No shifts in the last 30 days.</p>
      ) : (
        <section aria-labelledby="past-heading" className="mt-6">
          <h2 id="past-heading" className={staffH2}>
            The last 30 days
          </h2>
          <ul role="list" className={`${staffRows} ${headingGap}`}>
            {shifts.map((s) => (
              <ShiftRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
      {view === "upcoming" && shifts.length === 0 && (
        <Link href="/shifts/open" className={`${staffBtn.primary} mt-6`}>
          See all open shifts
        </Link>
      )}
    </>
  );
}

function Upcoming(props: BookedViewProps) {
  const [next, ...later] = props.shifts;
  if (!next) return <p className={emptyBox}>No shifts booked yet.</p>;
  return (
    <>
      <div className="mt-6">
        <NextPass
          shift={next}
          timeZone={props.timeZone}
          now={props.now}
          heading="shown"
          fresh={next.shiftId === props.newShiftId}
        />
      </div>
      <section aria-labelledby="later-heading" className={sectionGap.staff}>
        {/* The count sits beside the <h2>, not in it, so the section's name stays "Later" (as on
            the office pages). */}
        <div className="flex items-center">
          <h2 id="later-heading" className={staffH2}>
            Later
          </h2>
          {later.length > 0 && <span className={staffCount}>{later.length}</span>}
        </div>
        {later.length > 0 ? (
          <ul role="list" className={`${staffRows} ${headingGap}`}>
            {later.map((s) => (
              <UpcomingRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        ) : (
          <div className={`${emptyBox} ${headingGap} flex flex-col items-start gap-3`}>
            <p>Nothing else booked yet.</p>
            <Link href="/shifts/open" className={`${staffBtn.secondary} w-auto px-5`}>
              Find open shifts
              <Icon name="arrow" />
            </Link>
          </div>
        )}
      </section>
    </>
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

// An upcoming shift in the list: tap it to open the same details as the next shift's card. The
// arrow turns when it's open.
function UpcomingRow({ shift, timeZone, now, newShiftId }: BookedViewProps & { shift: MyShift }) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const fresh = shift.shiftId === newShiftId;
  return (
    <li className={`px-3.5 ${fresh ? "animate-move rounded-xl border-2 border-brand-ink" : ""}`}>
      <details>
        <summary className="flex min-h-14 list-none items-center gap-3.5 py-3 [&::-webkit-details-marker]:hidden">
          <DateTile dow={day.dow} day={day.day} />
          <span className="min-w-0 flex-1">
            <span className="block font-sign text-2xl leading-tight">{t.range}</span>
            <span className="block font-semibold">{roleLabel(shift.role)}</span>
            <span className="block text-base text-ink-muted">
              {shift.eventName ?? shift.site?.name ?? ""}
            </span>
            <TravelLine shift={shift} timeZone={timeZone} />
            {isOnNow(shift, now) && <span className="block text-base font-semibold">On now</span>}
          </span>
          {fresh && <Plate tone="brand">New</Plate>}
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
            className="shrink-0 text-ink-muted transition-transform duration-200 ease-sd [details[open]_&]:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="pb-4">
          <ShiftDetails shift={shift} />
          {!shift.site && !shift.instructions && (
            <p className={`mt-1 ${muted}`}>No site or instructions yet.</p>
          )}
          <ShiftActions shift={shift} now={now} timeZone={timeZone} />
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
function ShiftRow({ shift, timeZone }: BookedViewProps & { shift: MyShift }) {
  const [words, tone] = PAST_LABELS[shift.status];
  return (
    <li className={staffRow}>
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
