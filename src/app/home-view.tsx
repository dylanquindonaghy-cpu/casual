import Link from "next/link";
import type { NeedsItem } from "@/lib/credentials/status";
import {
  isOnNow,
  mapLink,
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
import { OfflineNotice } from "./my-shifts-view";
import { CancelShift } from "./shifts/cancel-shift";
import { AreaPrompt, FurtherNote } from "./shifts/open/travel-notes";
import { RequirementChips } from "./shifts/requirement-chips";
import {
  h2,
  headingGap,
  meta,
  muted,
  rows,
  sectionGap,
  staffBtn,
  staffBtnSmall,
} from "./ui/classes";
import { Icon } from "./ui/icons";
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

// An empty list keeps its place: a dashed frame and one sentence (Phase 17).
const emptyBox = "rounded-xl border border-dashed border-line-strong p-4 text-base text-ink-muted";

export function HomeView(props: HomeViewProps) {
  const { firstName, timeZone, now, open } = props;
  const updated = timeOnDay(now, timeZone);
  const urgent = open.shifts.filter((s) => s.isUrgent).slice(0, HOME_URGENT_MAX);
  const shown = new Set(urgent.map((s) => s.shiftId));
  const apply = open.shifts.filter((s) => !shown.has(s.shiftId)).slice(0, HOME_APPLY_MAX);
  return (
    <>
      <PageHeader title={`Hello ${firstName}`}>
        <p className={meta}>Updated {updated}</p>
      </PageHeader>
      <OfflineNotice updated={updated} />
      <NeedsUpdating needs={props.needs} photo={props.photo} timeZone={timeZone} now={now} />
      {urgent.length > 0 && (
        <section aria-labelledby="urgent-heading" className="mb-8">
          <h2
            id="urgent-heading"
            className="flex items-center gap-2 text-lg font-bold text-urgent-ink"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-urgent" />
            {URGENT_HEADING}
          </h2>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {urgent.map((s) => (
              <ShiftSummary key={s.shiftId} shift={s} timeZone={timeZone} />
            ))}
          </ul>
          <Link href="/urgent" className={`${staffBtn.secondary} mt-3`}>
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
        {open.area && <p className={`mt-1 ${meta}`}>{applyLimitText(open.area.maxMinutes)}</p>}
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
          <ul role="list" className={rows}>
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
      className={`mb-6 rounded-xl border p-4 ${
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

// A shift she could take, in short, as one row of a list: role · event, site; when · pay · post;
// what it needs (chips, 12H.2); places left; the travel line. The whole row opens the shift's
// page, where she can take it (the arrow says so).
function ShiftSummary({ shift: s, timeZone }: { shift: OpenShift; timeZone: string }) {
  const facts = [
    shiftWhen(s.startsAt, s.endsAt, timeZone),
    s.payRatePence != null ? perHour(s.payRatePence) : null,
    s.post ?? null,
  ].filter(Boolean);
  return (
    <li>
      <Link
        href={`/shifts/${s.shiftId}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-quiet-soft focus-visible:-outline-offset-2"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {s.isUrgent && (
            <span className="mb-1 flex">
              <StatusChip tone="urgent">Urgent</StatusChip>
            </span>
          )}
          <span className="font-semibold text-ink">{roleAndEvent(s.role, s.casualEvent)}</span>
          {s.site && <span className="text-base text-ink">{s.site.name}</span>}
          <span className={`${muted} tabular-nums`}>{facts.join(" · ")}</span>
          <RequirementChips requirements={s.requirements} as="span" className="mt-1" />
          <span className={muted}>
            {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
          </span>
          {s.travel && (
            <span className={muted} data-travel-line="">
              {travelLineText(s.travel, timeZone)}
            </span>
          )}
        </span>
        <Icon name="chevron" className="h-5 w-5 text-ink-muted" />
      </Link>
    </li>
  );
}

// Her next shift, in full (§4.2 item 4): when first and largest, then what and where, then the
// facts as a list she can scan (the labels quiet, the answers in ink), the instructions, "Open in
// maps" and "Ask for a change" side by side, and "Cancel this shift" in quiet red words.
function NextShift({ shift, timeZone, now }: { shift: MyShift; timeZone: string; now: Date }) {
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  // What she can still do before it starts (as on Booked: src/app/my-shifts-view.tsx ShiftActions).
  const canAct = shift.status === "confirmed" && shift.startsAt.getTime() > now.getTime();
  const facts: [label: string, value: string][] = [];
  if (shift.post) facts.push(["Post", shift.post]);
  if (shift.payRatePence != null) {
    facts.push(["Pay", payWords(shift.payRatePence, shift.startsAt, shift.endsAt)]);
  }
  if (shift.meetingPoint) facts.push(["Report to", shift.meetingPoint]);
  if (shift.uniform) facts.push(["Bring and wear", shift.uniform]);
  if (shift.travel) facts.push(["Getting there", travelLineText(shift.travel, timeZone)]);
  return (
    <section aria-labelledby="next-heading" className="rounded-2xl border border-line bg-card p-4">
      <h2 id="next-heading" className="text-sm font-semibold text-ink-muted">
        {isOnNow(shift, now) ? "On now" : "Your next shift"}
      </h2>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
        {shiftWhen(shift.startsAt, shift.endsAt, timeZone)}
      </p>
      <p className="mt-1 font-semibold">{roleAndEvent(shift.role, shift.eventName)}</p>
      {shift.site && (
        <div className="mt-1">
          <p className="text-base font-semibold">{shift.site.name}</p>
          {address && <p className={muted}>{address}</p>}
        </div>
      )}
      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-base">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
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
      {shift.instructions && (
        <div className="mt-3 rounded-xl bg-quiet-soft p-3 text-base">
          <h3 className="font-semibold">Instructions</h3>
          <p className="mt-1 whitespace-pre-line">{shift.instructions}</p>
        </div>
      )}
      {(map || canAct) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtnSmall}>
              Open in maps
            </a>
          )}
          {canAct && (
            <Link href={`/requests/new?shift=${shift.shiftId}`} className={staffBtnSmall}>
              Ask for a change
            </Link>
          )}
        </div>
      )}
      {canAct && (
        <div className="mt-1">
          {/* Keyed by the booking: after a cancellation the next shift moves into this card with
              its own, empty cancel state. */}
          <CancelShift key={shift.assignmentId} shiftId={shift.shiftId} />
        </div>
      )}
    </section>
  );
}
