import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsItem } from "@/lib/credentials/status";
import { mapLink, roleLabel, siteAddress, timeOnDay } from "@/lib/portal/format";
import {
  applyRowText,
  needsRowText,
  offlineUrgentText,
  urgentRowText,
} from "@/lib/portal/home-copy";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { dateParts, inDays, shiftLine, timeRange } from "@/lib/portal/sign-copy";
import { AREA_PROMPT, AREA_PROMPT_LINK, TRAVEL_PATH } from "@/lib/portal/travel-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { StaffPhoto } from "@/lib/uploads/photo";
import { HomeScreenHint } from "./home-screen-hint";
import { OfflineNotice } from "./my-shifts-view";
import { CancelShift } from "./shifts/cancel-shift";
import { BringAndWear, Fact, PayLine, TravelFigures } from "./shifts/shift-parts";
import { h2, staffBtn, staffBtnSmall, tapRow } from "./ui/classes";
import { Icon } from "./ui/icons";
import { DateTile, SignPlate } from "./ui/sign";

// Home (docs/office-v2.md 4.2; docs/screens.md `/`; 12H.1; Phase 18's redesign), one question:
// "when and where is my next shift, and is there anything I should do?". In this order: "Hello
// {first name}" and when it was updated; the no-signal notice (shown only in the offline copy);
// her next shift as a pass (when in sign figures, the role, the event and site, the gate), which
// opens in place into its details (getting there, where to report, what to bring and wear, pay,
// the instructions, then "Open in maps", "Ask for a change" and "Can't make it?"); with nothing
// booked, an empty pass and "Find a shift"; then "For you", at most four rows: the urgent shifts
// she can take (or, offline, that they need signal), what needs doing on Profile, her travel area
// to add (while she has none), and the other shifts she can apply for. Her other booked shifts are on the Shifts
// tab (`/shifts`). The pass is a <details>: it opens without JavaScript, and in the offline copy.
// Server-rendered; only "Can't make it?" and the home screen hint are client components.

export interface HomeViewProps {
  firstName: string;
  timeZone: string;
  now: Date;
  next: MyShift | null; // her next booking (or the one on now)
  needs: NeedsItem[];
  photo: StaffPhoto;
  open: OpenShiftsList; // the shifts she can take, urgent first (src/lib/portal/open-shifts.ts)
}

const time = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

export function HomeView(props: HomeViewProps) {
  const { firstName, timeZone, now } = props;
  const updated = time(now, timeZone);
  // The kept copy can be opened days later, so what it says about itself carries the day too.
  const savedAt = timeOnDay(now, timeZone);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Hello {firstName}</h1>
        <p className="text-base text-ink-muted tabular-nums">Updated {updated}</p>
      </header>
      <OfflineNotice updated={savedAt} />
      {props.next ? <NextShift shift={props.next} timeZone={timeZone} now={now} /> : <EmptyPass />}
      <ForYou {...props} savedAt={savedAt} />
      <HomeScreenHint />
    </div>
  );
}

// --- The pass ------------------------------------------------------------------------------

// The band across the pass's top, in the firm's colour, with a lanyard slot.
function Band({ heading, when }: { heading: string; when: string }) {
  return (
    <div className="relative flex items-center justify-between gap-3 bg-brand-bar px-4 pt-5 pb-3 text-on-brand-bar">
      <span
        aria-hidden="true"
        className="absolute top-[7px] left-1/2 -ml-[22px] h-[7px] w-11 rounded bg-canvas"
      />
      <h2 id="next-heading" className="text-lg font-semibold">
        {heading}
      </h2>
      <span className="text-lg">{when}</span>
    </div>
  );
}

// Her next shift (§4.2 item 4) as a pass. Closed, it answers when, what and where; open, the rest.
function NextShift({ shift, timeZone, now }: { shift: MyShift; timeZone: string; now: Date }) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const onNow = shift.startsAt.getTime() <= now.getTime() && now.getTime() < shift.endsAt.getTime();
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  // What she can still do before it starts (as on Booked: src/app/my-shifts-view.tsx ShiftActions).
  const canAct = shift.status === "confirmed" && shift.startsAt.getTime() > now.getTime();
  // Closed, the event and its site; how far (both ways, so no one sees only a drive) is inside.
  const event = shift.eventName ?? shift.site?.name ?? null;
  const place = shift.eventName ? (shift.site?.name ?? null) : null;
  const spoken = [`${roleLabel(shift.role)}, ${day.long}, ${t.spoken}`, event, shift.post].filter(
    Boolean,
  );
  return (
    <section
      aria-labelledby="next-heading"
      data-pass=""
      className="overflow-hidden rounded-2xl border border-line bg-card shadow-pass"
    >
      <Band
        heading={onNow ? "On now" : "Your next shift"}
        when={inDays(shift.startsAt, shift.endsAt, now, timeZone)}
      />
      <details className="group">
        <summary
          aria-label={`${spoken.join(", ")}. Details`}
          className="block cursor-pointer list-none focus-visible:-outline-offset-4 [&::-webkit-details-marker]:hidden"
        >
          <div className="flex items-center gap-4 p-4">
            <DateTile dow={day.dow} day={day.day} month={day.month} size="lg" />
            <div className="min-w-0">
              <p className="font-sign text-4xl text-ink">{t.range}</p>
              <p className="mt-1 text-lg font-semibold">{roleLabel(shift.role)}</p>
              {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
            </div>
          </div>
          <div className="mx-4 border-t border-line" />
          <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
            <div className="group-open:hidden">
              {event && <p className="text-lg leading-snug font-semibold">{event}</p>}
              {place && <p className="text-base text-ink-muted">{place}</p>}
            </div>
            <div className="flex items-center gap-3">
              <span className="group-open:hidden">
                {shift.post && <SignPlate>{shift.post}</SignPlate>}
              </span>
              <span className="ml-auto flex min-h-11 items-center gap-1 font-semibold text-brand-ink">
                <span className="group-open:hidden">Details</span>
                <span className="hidden group-open:inline">Hide details</span>
                <Icon
                  name="chevron"
                  className="transition-transform duration-200 ease-sd group-open:-rotate-90"
                />
              </span>
            </div>
          </div>
        </summary>
        <div className="flex animate-open-late flex-col gap-5 px-4 pb-5">
          <div className="flex items-start gap-3.5">
            {shift.post && <SignPlate>{shift.post}</SignPlate>}
            <div className="min-w-0">
              {event && <p className="text-lg leading-snug font-semibold">{event}</p>}
              {address ? (
                <p className="text-base text-ink-muted">{address}</p>
              ) : (
                shift.site &&
                shift.eventName && <p className="text-base text-ink-muted">{shift.site.name}</p>
              )}
            </div>
          </div>
          {shift.travel && <TravelFigures travel={shift.travel} timeZone={timeZone} />}
          {shift.meetingPoint && (
            <Fact label="Report to">
              <p className="text-lg font-semibold">{shift.meetingPoint}</p>
            </Fact>
          )}
          {shift.uniform && (
            <Fact label="Bring and wear">
              <BringAndWear text={shift.uniform} />
            </Fact>
          )}
          {shift.payRatePence != null && (
            <PayLine
              ratePence={shift.payRatePence}
              startsAt={shift.startsAt}
              endsAt={shift.endsAt}
            />
          )}
          {shift.instructions && (
            <Fact label="Instructions">
              <p className="text-base whitespace-pre-line">{shift.instructions}</p>
            </Fact>
          )}
          {(map || canAct) && (
            <div className="flex flex-col gap-2.5">
              {map && (
                <a
                  href={map}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={staffBtn.primary}
                >
                  <Icon name="pin" size={22} />
                  Open in maps
                </a>
              )}
              {canAct && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtnSmall}>
                    Ask for a change
                  </Link>
                  {/* Keyed by the booking: after a cancellation the next shift moves into the pass
                      with its own, empty cancel state. */}
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
              )}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

// Nothing booked: the pass's outline, and the way to find a shift.
function EmptyPass() {
  return (
    <section
      aria-labelledby="next-heading"
      className="flex animate-in flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed border-line-strong bg-card px-5 py-6 text-center"
    >
      <span
        aria-hidden="true"
        className="block w-18 overflow-hidden rounded-lg border-[1.5px] border-dashed border-line-strong"
      >
        <span className="block h-6 bg-raised" />
        <span className="block h-14" />
      </span>
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

// --- For you -------------------------------------------------------------------------------

const TILE = "flex size-12 shrink-0 items-center justify-center rounded-lg";

function Row({
  href,
  tile,
  label,
  title,
  sub,
  extra,
}: {
  href?: string;
  tile: ReactNode;
  label?: ReactNode;
  title: string;
  sub: string;
  extra?: Record<string, string>;
}) {
  const body = (
    <>
      {tile}
      <span className="min-w-0 flex-1">
        {label}
        <span className="block text-lg leading-snug font-semibold">{title}</span>
        {sub && <span className="block text-base text-ink-muted">{sub}</span>}
      </span>
      {href && <Icon name="chevron" size={22} className="text-ink-muted" />}
    </>
  );
  return (
    <li {...extra}>
      {href ? (
        <Link href={href} className={tapRow}>
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3.5 p-3.5">{body}</div>
      )}
    </li>
  );
}

function ForYou({
  timeZone,
  now,
  needs,
  photo,
  open,
  savedAt,
}: HomeViewProps & { savedAt: string }) {
  const urgent = open.shifts.filter((s) => s.isUrgent);
  const rest = open.shifts.filter((s) => !s.isUrgent);
  const need = needsRowText(needs, photo, wallTimeOf(now, timeZone).year);
  const areaPrompt = open.travelOn && !open.area;
  const u = urgentRowText(urgent, timeZone);
  const a = applyRowText(rest, urgent.length > 0, timeZone);
  return (
    <section aria-labelledby="for-you-heading" className="flex animate-in flex-col gap-2.5">
      <h2 id="for-you-heading" className={h2}>
        For you
      </h2>
      <ul
        role="list"
        className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card"
      >
        {urgent.length > 0 && (
          <Row
            href="/urgent"
            extra={{ "data-online-only": "", "data-for-you": "urgent" }}
            tile={
              <span className={`${TILE} bg-urgent-fill text-on-urgent`}>
                <Icon name="urgent" size={24} />
              </span>
            }
            label={<span className="block text-base font-semibold text-urgent">Urgent</span>}
            title={u.title}
            sub={u.sub}
          />
        )}
        <Row
          extra={{ "data-offline-only": "", "data-for-you": "offline" }}
          tile={
            <span className={`${TILE} bg-raised text-ink-muted`}>
              <Icon name="offline" size={24} />
            </span>
          }
          title="Open shifts need signal"
          sub={offlineUrgentText(urgent.length, savedAt)}
        />
        {need && (
          <Row
            href={need.href}
            extra={{ "data-for-you": "needs" }}
            tile={
              <span
                className={`${TILE} ${need.urgent ? "bg-urgent-fill text-on-urgent" : "bg-hivis text-on-hivis"}`}
              >
                <Icon name={need.photo ? "camera" : need.urgent ? "urgent" : "check"} size={24} />
              </span>
            }
            label={
              <span
                className={`block text-base font-semibold ${need.urgent ? "text-urgent" : "text-ink-muted"}`}
              >
                {need.urgent ? "Needs doing now" : "Needs doing"}
              </span>
            }
            title={need.title}
            sub={need.sub}
          />
        )}
        {areaPrompt ? (
          <Row
            href={TRAVEL_PATH}
            extra={{ "data-online-only": "", "data-for-you": "area" }}
            tile={
              <span className={`${TILE} bg-brand-soft text-brand-ink`}>
                <Icon name="pin" size={24} />
              </span>
            }
            title={AREA_PROMPT_LINK}
            sub={AREA_PROMPT}
          />
        ) : null}
        <Row
          href="/shifts/open"
          extra={{ "data-online-only": "", "data-for-you": "apply" }}
          tile={
            <span className={`${TILE} bg-brand-soft text-brand-ink`}>
              <Icon name="shifts" size={24} />
            </span>
          }
          title={
            rest.length > 0
              ? a.title
              : urgent.length > 0
                ? "No other shifts open"
                : "No open shifts right now"
          }
          sub={
            rest.length > 0
              ? a.sub
              : open.offerAlerts
                ? "We'll message you when something matches."
                : "Check back later."
          }
        />
      </ul>
    </section>
  );
}
