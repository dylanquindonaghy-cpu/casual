import Link from "next/link";
import { isOnNow, roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
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
import { count, h2, headingGap, muted, row, rows, sectionGap, staffBtn } from "../ui/classes";
import { PageHeader } from "../ui/page-header";
import { StatusChip, type StatusTone } from "../ui/status-chip";

// Booked (docs/office-v2.md 4.1, 4.3; docs/screens.md `/shifts`; 12H.1): her bookings, on the
// Shifts tab next to Open. A switch between Upcoming and the last 30 days (`?view=past`), the next
// shift in a card (time, role, site, map link, instructions, then what you can do), the rest in a
// list where each opens to the same details. Each upcoming shift shows its travel line ("7.2 miles ·
// 18 min by car · …": 12G.3). Kept for when there's no signal, like Home (public/sw.js), with the
// same notice. Server-rendered HTML (the list opens with <details>); only "Cancel this shift" is a
// small client component. Home (`/`) has the greeting, Needs updating, urgent shifts and the next
// shift in full (src/app/home-view.tsx).

export interface BookedViewProps {
  timeZone: string;
  now: Date;
  view: ShiftsView;
  shifts: MyShift[];
}

// A plain grey box for "nothing here" sentences.
const emptyBox = "mt-6 rounded-xl bg-quiet-soft p-4 text-ink";

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
      <nav
        aria-label="Which shifts"
        className="grid grid-cols-2 divide-x-2 divide-line-strong overflow-hidden rounded-xl border-2 border-line-strong"
      >
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

function NextShift({ shift, timeZone, now }: BookedViewProps & { shift: MyShift }) {
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

// An upcoming shift in the list: tap it to open the same details as the next shift's card. The
// arrow turns when it's open.
function UpcomingRow({ shift, timeZone, now }: BookedViewProps & { shift: MyShift }) {
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
function ShiftRow({ shift, timeZone }: BookedViewProps & { shift: MyShift }) {
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
