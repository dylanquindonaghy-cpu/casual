import Link from "next/link";
import type { NeedsItem } from "@/lib/credentials/status";
import type { FirmVoice } from "@/lib/messaging/templates";
import {
  isOnNow,
  payWords,
  perHour,
  roleAndEvent,
  shiftWhen,
  siteAddress,
  timeOnDay,
} from "@/lib/portal/format";
import { photoNeedsUpdating, type MyShift } from "@/lib/portal/my-shifts";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { needsText, needsUpload } from "@/lib/portal/qualification-copy";
import { photoDates } from "@/lib/portal/upload-copy";
import { travelLineText } from "@/lib/travel/line-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { StaffPhoto } from "@/lib/uploads/photo";
import { HomeScreenHint } from "./home-screen-hint";
import { OfflineNotice, ShiftActions, ShiftMapAndInstructions } from "./my-shifts-view";
import { AreaPrompt, FurtherNote } from "./shifts/open/travel-notes";
import { card, h2, headingGap, muted, sectionGap, staffBtn } from "./ui/classes";
import { PageHeader } from "./ui/page-header";
import { StatusChip } from "./ui/status-chip";

// Home (docs/office-v2.md 4.2; docs/screens.md `/`; 12H.1), in this order: "Hello {first name}"
// and when it was updated; the no-signal notice (shown only in the offline copy); "Needs updating"
// (one action per row: the qualifications in §4.2's order, and her staff photo when it's overdue or
// due soon); the urgent shifts she can take; her next shift in full (when, role · event, site and
// address, post, pay with its estimate, where to report, uniform, getting there, then "Open in
// maps", "Ask for a change" and "Cancel this shift"); the top 3 other shifts she can apply for,
// with how far they're limited and how many more are further. Her other booked shifts are on the
// Shifts tab (`/shifts`). Server-rendered; only "Cancel this shift" and the home screen hint are
// client components.

export const HOME_URGENT_MAX = 3;
export const HOME_APPLY_MAX = 3;
export const URGENT_HEADING = "Urgent: needed now, and you can take them";
export const APPLY_HEADING = "Shifts you can apply for";

export interface HomeViewProps {
  firstName: string;
  voice: FirmVoice;
  timeZone: string;
  now: Date;
  next: MyShift | null; // her next booking (or the one on now)
  needs: NeedsItem[];
  photo: StaffPhoto;
  open: OpenShiftsList; // the shifts she can take, urgent first (src/lib/portal/open-shifts.ts)
}

// "Only shifts your licences and hours allow, up to 45 minutes from your home area."
export const applyLimitText = (maxMinutes: number) =>
  `Only shifts your licences and hours allow, up to ${maxMinutes} minutes from your home area.`;

const emptyBox = "rounded-xl bg-quiet-soft p-4 text-ink";

export function HomeView(props: HomeViewProps) {
  const { firstName, voice, timeZone, now, open } = props;
  const updated = timeOnDay(now, timeZone);
  const urgent = open.shifts.filter((s) => s.isUrgent).slice(0, HOME_URGENT_MAX);
  const shown = new Set(urgent.map((s) => s.shiftId));
  const apply = open.shifts.filter((s) => !shown.has(s.shiftId)).slice(0, HOME_APPLY_MAX);
  return (
    <>
      <PageHeader eyebrow={voice.name} title={`Hello ${firstName}`}>
        <p className={muted}>Updated {updated}</p>
      </PageHeader>
      <OfflineNotice updated={updated} />
      <NeedsUpdating needs={props.needs} photo={props.photo} timeZone={timeZone} now={now} />
      {urgent.length > 0 && (
        <section
          aria-labelledby="urgent-heading"
          className="mb-6 rounded-xl border-2 border-urgent bg-urgent-soft p-4"
        >
          <h2 id="urgent-heading" className="text-lg font-bold text-urgent-ink">
            {URGENT_HEADING}
          </h2>
          <ul role="list" className="mt-3 flex flex-col gap-3">
            {urgent.map((s) => (
              <ShiftSummary key={s.shiftId} shift={s} timeZone={timeZone} />
            ))}
          </ul>
          <Link href="/urgent" className={`${staffBtn.primary} mt-3`}>
            See urgent shifts
          </Link>
        </section>
      )}
      {props.next ? (
        <NextShift shift={props.next} timeZone={timeZone} now={now} />
      ) : (
        <p className={emptyBox}>No shifts booked yet.</p>
      )}
      <section aria-labelledby="apply-heading" className={sectionGap.staff}>
        <h2 id="apply-heading" className={h2}>
          {APPLY_HEADING}
        </h2>
        {open.area && <p className={`mt-1 ${muted}`}>{applyLimitText(open.area.maxMinutes)}</p>}
        <div className={headingGap}>
          <AreaPrompt list={open} />
        </div>
        {apply.length === 0 ? (
          <p className={emptyBox}>
            {open.offerAlerts
              ? "Nothing else open right now. We'll message you when something matches."
              : "Nothing else open right now. Check back later."}
          </p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {apply.map((s) => (
              <ShiftSummary key={s.shiftId} shift={s} timeZone={timeZone} />
            ))}
          </ul>
        )}
        <FurtherNote list={open} />
        <Link href="/shifts/open" className={`${staffBtn.secondary} mt-4`}>
          See all open shifts
        </Link>
      </section>
      <HomeScreenHint />
    </>
  );
}

// "Needs updating" (docs/office-v2.md 4.2), shown only when something does: one row per thing,
// each with its one action, the one that stops a booked shift first; her photo at its level (2
// when overdue, 3 when due soon). Red when something stops her working.
function NeedsUpdating({
  needs,
  photo,
  timeZone,
  now,
}: {
  needs: NeedsItem[];
  photo: StaffPhoto;
  timeZone: string;
  now: Date;
}) {
  const photoRow = photoNeedsUpdating(photo);
  if (needs.length === 0 && !photoRow) return null;
  const year = wallTimeOf(now, timeZone).year;
  const photoLevel = photo.status === "overdue" ? 2 : 3;
  const urgent = needs.some((n) => n.level <= 2) || (photoRow && photoLevel === 2);
  const rows = needs.map((n) => ({
    key: n.qualification.type,
    level: n.level,
    row: (
      <li key={n.qualification.type}>
        {needsText(n, year)}
        {/* Where she can sort it herself (12F.2): straight to that card's upload. */}
        {needsUpload(n.qualification) && (
          <>
            {" "}
            <Link
              href={`/profile/upload/${n.qualification.type}`}
              aria-label={`Upload your ${n.qualification.name}`}
              className="font-semibold underline underline-offset-4"
            >
              Upload it
            </Link>
          </>
        )}
      </li>
    ),
  }));
  if (photoRow) {
    // After the qualifications of its own level or worse (a stable sort keeps theirs in order).
    rows.push({
      key: "photo",
      level: photoLevel,
      row: (
        <li key="photo" data-needs="photo">
          {photo.status === "overdue"
            ? "Your staff photo is overdue."
            : "Your staff photo is due soon."}{" "}
          <span className="tabular-nums">{photoDates(photo, year)}.</span>{" "}
          <Link
            href="/profile#photo-heading"
            className="font-semibold underline underline-offset-4"
          >
            Take a new photo
          </Link>
        </li>
      ),
    });
  }
  rows.sort((a, b) => a.level - b.level);
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
        {rows.map((r) => r.row)}
      </ul>
      <Link href="/profile" className={`${staffBtn.secondary} mt-3`}>
        See your qualifications
      </Link>
    </section>
  );
}

// A shift she could take, in short: role · event, site; when · pay · post; places left; the travel
// line. The whole card opens the shift's page, where she can take it.
function ShiftSummary({ shift: s, timeZone }: { shift: OpenShift; timeZone: string }) {
  const facts = [
    shiftWhen(s.startsAt, s.endsAt, timeZone),
    s.payRatePence != null ? perHour(s.payRatePence) : null,
    s.post ?? null,
  ].filter(Boolean);
  return (
    <li className={`${card}${s.isUrgent ? " border-l-4 border-l-urgent" : ""}`}>
      <Link href={`/shifts/${s.shiftId}`} className="block rounded-md focus-visible:outline-2">
        {s.isUrgent && (
          <span className="mb-2 flex">
            <StatusChip tone="urgent">Urgent</StatusChip>
          </span>
        )}
        <span className="block font-semibold text-ink underline decoration-line-strong underline-offset-4">
          {roleAndEvent(s.role, s.eventName)}
        </span>
        {s.site && <span className="block">{s.site.name}</span>}
        <span className={`block ${muted} tabular-nums`}>{facts.join(" · ")}</span>
        <span className={`block ${muted}`}>
          {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
        </span>
        <span className={`block ${muted}`} data-travel-line="">
          {travelLineText(s.travel, timeZone)}
        </span>
      </Link>
    </li>
  );
}

// Her next shift, in full (§4.2 item 4).
function NextShift({ shift, timeZone, now }: { shift: MyShift; timeZone: string; now: Date }) {
  const address = shift.site ? siteAddress(shift.site) : null;
  const facts: [label: string, value: string][] = [];
  if (shift.post) facts.push(["Post", shift.post]);
  if (shift.payRatePence != null) {
    facts.push(["Pay", payWords(shift.payRatePence, shift.startsAt, shift.endsAt)]);
  }
  if (shift.meetingPoint) facts.push(["Report to", shift.meetingPoint]);
  if (shift.uniform) facts.push(["Bring and wear", shift.uniform]);
  if (shift.travel) facts.push(["Getting there", travelLineText(shift.travel, timeZone)]);
  return (
    <section aria-labelledby="next-heading" className="rounded-2xl border-2 border-ink bg-card p-4">
      <h2 id="next-heading" className="text-base font-semibold text-ink-muted">
        {isOnNow(shift, now) ? "On now" : "Your next shift"}
      </h2>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
        {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
      </p>
      <p className="mt-1 font-semibold">{roleAndEvent(shift.role, shift.eventName)}</p>
      {shift.site && (
        <div className="mt-2">
          <p className="font-semibold">{shift.site.name}</p>
          {address && <p className={muted}>{address}</p>}
        </div>
      )}
      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold">{label}</dt>
              <dd
                className="break-words"
                {...(label === "Getting there" ? { "data-travel-line": "" } : {})}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ShiftMapAndInstructions shift={shift} />
      <ShiftActions shift={shift} now={now} />
    </section>
  );
}
