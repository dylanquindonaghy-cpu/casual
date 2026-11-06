import Link from "next/link";
import { isOnNow, roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { messageOfficeHref } from "@/lib/portal/message-office";
import { hoursText } from "@/lib/portal/pay-format";
import { RECORD_PATH, RECORD_TITLE } from "@/lib/portal/record-copy";
import { MARK_WORDS, NOT_MARKED_YET } from "@/lib/portal/request-kinds";
import { dateParts, timeRange } from "@/lib/portal/sign-copy";
import { NextPass } from "../next-pass";
import type { MyShift, ShiftsView } from "@/lib/portal/my-shifts";
import { travelLineText } from "@/lib/travel/line-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import {
  BOOKED_PATH,
  OfflineNotice,
  RECORD_ROW_LINE,
  ShiftActions,
  ShiftDetails,
  ShiftsSwitch,
} from "../my-shifts-view";
import {
  btn,
  disc,
  emptyBox,
  headingGap,
  muted,
  nums,
  sectionGap,
  staffBtn,
  staffCount,
  staffH2,
  staffRows,
  tab,
  tabCount,
  tabCurrent,
  tabs,
  tapRow,
} from "../ui/classes";
import { Icon } from "../ui/icons";
import { PageHeader } from "../ui/page-header";
import { Plate } from "../ui/plate";
import { DateTile } from "../ui/sign";
import { StatusChip, type StatusTone } from "../ui/status-chip";

// Booked (docs/office-v2.md 4.1, 4.3; docs/screens.md `/shifts`, "### 28.13"; 12H.1; Phase 20): her
// bookings, on the Shifts tab next to Open. "Booked shifts" with "Updated 21:35" beside it (the
// page header, online only); the Open | Booked switch; then Upcoming | Past 90 days as the office's
// tabs with their counts (Past's online only: Phase 28.13). Upcoming: the next shift as the same
// pass as Home's, with the same three buttons under it (src/app/next-pass.tsx), then "Later": the
// rest in a list where each opens to its details, or, with nothing else booked, the empty box with
// "See open shifts". Each later shift shows its travel line ("7.2 miles · 18 min by car · …":
// 12G.3). Past 90 days (`?view=past`): the way to her shift record (28.4), then her bookings on the
// sessions reliability counts, each with its hours and mark, opening to "Think this mark is wrong?"
// (a marked one), "Ask about the pay for this shift" (payroll's pay query: golden rule 9) and "See
// it in your shift record". Kept for when there's no signal, like Home (public/sw.js keeps /shifts
// with no query only: Upcoming), with the same notice. Server-rendered HTML (the lists open with
// <details>); only "Can't make it?" is a small client component.

export interface BookedViewProps {
  firmName: string;
  timeZone: string;
  now: Date;
  view: ShiftsView;
  shifts: MyShift[];
  // How many each tab lists (myShiftCounts). Without them, the current tab counts what it shows.
  counts?: { upcoming: number; past: number };
  // The shift she has just taken (`?new=`, from "See my shifts" after "Take shift"): it moves into
  // its place marked "New" (Phase 18's motion).
  newShiftId?: string;
}

// "21:35": beside the headline, online only (the kept copy's notice carries the day too).
const clockTime = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

export function BookedView(props: BookedViewProps) {
  const { view, shifts, now, timeZone } = props;
  const updated = timeOnDay(now, timeZone);
  const counts = props.counts ?? {
    upcoming: view === "upcoming" ? shifts.length : null,
    past: view === "past" ? shifts.length : null,
  };
  return (
    <>
      <PageHeader title="Booked shifts" updated={`Updated ${clockTime(now, timeZone)}`} />
      <OfflineNotice updated={updated} />
      <ShiftsSwitch current="booked" />
      <nav aria-label="Which shifts" className={tabs}>
        <ViewTab href={BOOKED_PATH} current={view === "upcoming"} count={counts.upcoming}>
          Upcoming
        </ViewTab>
        <ViewTab
          href={`${BOOKED_PATH}?view=past`}
          current={view === "past"}
          count={counts.past}
          onlineOnly
        >
          Past 90 days
        </ViewTab>
      </nav>
      {view === "upcoming" ? <Upcoming {...props} /> : <Past {...props} />}
      {view === "upcoming" && shifts.length === 0 && (
        <Link href="/shifts/open" className={`${staffBtn.primary} mt-6`}>
          See open shifts
        </Link>
      )}
    </>
  );
}

// One of the two tabs: the office's (a pill 44px tall, the current one under a lens, with
// aria-current), its count beside the word. Past's count is online only: the copy kept for no
// signal is Upcoming's, and says nothing about Past.
function ViewTab({
  href,
  current,
  count,
  onlineOnly = false,
  children,
}: {
  href: string;
  current: boolean;
  count: number | null;
  onlineOnly?: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={current ? tabCurrent : tab}
    >
      {children}
      {count !== null && (
        <span data-online-only={onlineOnly ? "" : undefined} className={tabCount(current)}>
          {count}
        </span>
      )}
    </Link>
  );
}

function Upcoming(props: BookedViewProps) {
  const [next, ...later] = props.shifts;
  if (!next) return <p className={`${emptyBox} mt-6`}>No shifts booked yet.</p>;
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
          <div className={`${emptyBox} ${headingGap}`}>
            <p>Nothing else booked yet.</p>
            <Link href="/shifts/open" className={`${staffBtn.secondary} w-auto px-5`}>
              See open shifts
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

// The arrow at a row's end that turns when its <details> is open.
function Turn() {
  return (
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
  );
}

const summaryRow =
  "flex min-h-14 list-none items-center gap-3.5 py-3 [&::-webkit-details-marker]:hidden";

// An upcoming shift in the list: tap it to open the same details as the next shift's card. The
// arrow turns when it's open.
function UpcomingRow({ shift, timeZone, now, newShiftId }: BookedViewProps & { shift: MyShift }) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const fresh = shift.shiftId === newShiftId;
  return (
    <li className={`px-3.5 ${fresh ? "animate-move rounded-row border-2 border-brand-ink" : ""}`}>
      <details>
        <summary className={summaryRow}>
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
          <Turn />
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

// The way to her shift record (28.4): the top of Past, and a row on Profile.
function RecordRow() {
  return (
    <Link href={RECORD_PATH} className={`glass rounded-inner ${tapRow} press mt-6 min-h-20 px-4`}>
      <span aria-hidden="true" className={`${disc.base} ${disc.quiet}`}>
        <Icon name="log" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg leading-snug font-medium text-ink">{RECORD_TITLE}</span>{" "}
        <span className="block text-base text-ink-muted">{RECORD_ROW_LINE}</span>
      </span>
      <Icon name="chevron" size={22} className="text-ink-muted" />
    </Link>
  );
}

// Past 90 days: the way to her record, then the rows, newest first, or the empty box.
function Past(props: BookedViewProps) {
  return (
    <>
      <RecordRow />
      {props.shifts.length === 0 ? (
        <p className={`${emptyBox} ${sectionGap.staff}`}>No shifts in the last 90 days.</p>
      ) : (
        <section aria-labelledby="past-heading" className={sectionGap.staff}>
          <h2 id="past-heading" className={staffH2}>
            The last 90 days
          </h2>
          <ul role="list" className={`${staffRows} ${headingGap}`}>
            {props.shifts.map((s) => (
              <PastRow key={s.assignmentId} shift={s} {...props} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// A past booking's mark, in its colour, from her booking row: the office marked it worked, or not
// attended, or hasn't marked it yet (grey).
export function pastMark(status: MyShift["status"]): [words: string, tone: StatusTone] {
  if (status === "completed") return [MARK_WORDS.completed, "done"];
  if (status === "no_show") return [MARK_WORDS.no_show, "urgent"];
  return [NOT_MARKED_YET, "quiet"];
}

// A past booking: its day and times, role and site, the hours booked and the mark. Tap it to open
// what she can do (online only: never in the kept copy): say the mark is wrong (a marked one: the
// attendance form, 28.2's askAboutMark, which never changes the mark), ask payroll about its pay
// (the pay query behind her code, golden rule 9: messageOfficeHref sends an ended session's pay
// question there), or see it in her shift record.
function PastRow({ shift, timeZone, now }: BookedViewProps & { shift: MyShift }) {
  const [words, tone] = pastMark(shift.status);
  const hours = Math.max(0, shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
  const marked = shift.status === "completed" || shift.status === "no_show";
  return (
    <li className="px-4">
      <details>
        <summary className={summaryRow}>
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${nums}`}>
              {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
            </span>
            <span className={`block ${muted}`}>
              {roleLabel(shift.role)}
              {shift.site ? ` at ${shift.site.name}` : ""}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`text-base text-ink ${nums}`}>{hoursText(hours)}</span>
              <StatusChip tone={tone}>{words}</StatusChip>
            </span>
          </span>
          <Turn />
        </summary>
        <div data-online-only="" data-past-actions="" className="flex flex-col gap-3 pb-4">
          {marked && (
            <div className="flex flex-col gap-2">
              <p className="text-base font-semibold text-ink">Think this mark is wrong?</p>
              <Link
                href={`/requests/new?shift=${shift.shiftId}&kind=attendance`}
                className={staffBtn.secondary}
              >
                Tell the office
              </Link>
            </div>
          )}
          <Link
            href={messageOfficeHref({ id: shift.shiftId, endsAt: shift.endsAt }, "pay", now)}
            className={staffBtn.secondary}
          >
            Ask about the pay for this shift
          </Link>
          <Link href={RECORD_PATH} className={`${btn.link} self-start`}>
            See it in your shift record
          </Link>
        </div>
      </details>
    </li>
  );
}
