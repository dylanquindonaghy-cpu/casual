import Link from "next/link";
import type { ReactNode } from "react";
import { mapLink, roleLabel, siteAddress, soonLabel, timeOnDay } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import { requirementWords, strikeNoteText } from "@/lib/portal/shift-page-copy";
import { dateParts, placesLeftText, timeRange } from "@/lib/portal/sign-copy";
import { wallTimeOf } from "@/lib/time/zoned";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { ShiftActions } from "../../my-shifts-view";
import { staffBtn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { DateTile, Seats, SignPlate } from "../../ui/sign";
import { StatusChip } from "../../ui/status-chip";
import { TakeShiftButton } from "../open/take-shift-button";
import { BringAndWear, Fact, PayLine, TravelFigures } from "../shift-parts";
import { ReviewForm } from "./review-form";

// One shift's page (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]`; 12H.2; Phase 18): the
// way back, then the shift as a card like Home's pass: "Urgent, needed now" on a red band when it
// is, the date tile, the time in sign figures, the role (the page's heading), then the event, the
// site and its address and the post; getting there from her home area as three figures with "Open
// in maps"; the places as seats ("1 of 4 places left"); what it needs, a tag each with her status
// (and where she can sort one herself, "upload it"); where to report; what to bring and wear; the
// pay with its estimate. Under it what she can do: "Take shift" in a bar that stays at the bottom
// of the screen, with the strike note; when it opens (fair rotation); the rules' reasons with
// "Ask the office to review"; or, booked, her instructions and actions. Filled, started and
// cancelled say so.

const capitalise = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

const TONE_TAG = {
  done: "bg-done-soft text-done-ink",
  attention: "bg-attention-soft text-attention-ink",
  urgent: "bg-urgent-soft text-urgent-ink",
} as const;
const TONE_WORDS = {
  done: "text-ink-muted",
  attention: "text-attention-ink",
  urgent: "font-semibold text-urgent-ink",
} as const;
const TONE_ICON = { done: "check", attention: "clock", urgent: "urgent" } as const;

function ShiftCard({
  shift,
  facts,
  placesLeft,
  timeZone,
  status,
}: {
  shift: ShiftSummary | MyShift;
  facts: ShiftFacts;
  placesLeft: number | null;
  timeZone: string;
  status?: ReactNode;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  const year = wallTimeOf(shift.startsAt, timeZone).year;
  const needs = facts.requirements.map((r) => ({
    r,
    w: requirementWords(r.status, { lastDay: facts.lastDay, year, uploadable: r.uploadable }),
  }));
  return (
    <section
      aria-labelledby="shift-heading"
      className="animate-open overflow-hidden rounded-2xl border border-line bg-card shadow-pass"
    >
      {facts.isUrgent && (
        <p className="flex items-center gap-2 bg-urgent-fill px-4 py-2.5 font-semibold text-on-urgent">
          <Icon name="urgent" size={18} />
          Urgent, needed now
        </p>
      )}
      <div className="flex items-center gap-4 p-4">
        <DateTile
          dow={day.dow}
          day={day.day}
          month={day.month}
          size="lg"
          urgent={facts.isUrgent}
          label={day.long}
        />
        <div className="min-w-0">
          <p className="font-sign text-4xl text-ink">{t.range}</p>
          <h1 id="shift-heading" className="mt-1 text-lg font-semibold text-ink">
            {roleLabel(shift.role)}
          </h1>
          {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
        </div>
      </div>
      <div className="flex animate-open-late flex-col gap-5 px-4 pb-5">
        {status}
        <div className="flex items-start gap-3.5 border-t border-line pt-3.5">
          {facts.post && <SignPlate>{facts.post}</SignPlate>}
          <div className="min-w-0">
            <p className="text-lg leading-snug font-semibold">
              {facts.eventName ?? shift.site?.name ?? roleLabel(shift.role)}
            </p>
            {facts.eventName && shift.site && (
              <p className="text-base text-ink-muted">{shift.site.name}</p>
            )}
            {address && <p className="text-base text-ink-muted">{address}</p>}
          </div>
        </div>
        {(facts.travel || map) && (
          <section aria-labelledby="getting-there-heading" className="flex flex-col gap-2.5">
            <h2 id="getting-there-heading" className="text-base text-ink-muted">
              Getting there{facts.travel ? ", from your home area" : ""}
            </h2>
            {facts.travel && <TravelFigures travel={facts.travel} timeZone={timeZone} />}
            {map && (
              <a
                href={map}
                target="_blank"
                rel="noopener noreferrer"
                className={staffBtn.secondary}
              >
                <Icon name="pin" size={22} />
                Open in maps
              </a>
            )}
          </section>
        )}
        {placesLeft !== null && (
          <Fact label="Places">
            <p className="flex flex-wrap items-center gap-3">
              <Seats
                taken={facts.headcount - placesLeft}
                total={facts.headcount}
                size="md"
                urgent={facts.isUrgent}
              />
              <span className="text-lg font-semibold">
                {placesLeftText(placesLeft, facts.headcount)}
              </span>
            </p>
          </Fact>
        )}
        {needs.length > 0 && (
          <section aria-labelledby="needs-heading">
            <h2 id="needs-heading" className="mb-1.5 text-base text-ink-muted">
              You need
            </h2>
            <ul role="list" className="flex flex-col gap-2">
              {needs.map(({ r, w }) => (
                <li key={r.code} data-requirement={r.code} className="flex flex-col gap-0.5">
                  <span
                    className={`inline-flex min-h-8 items-center gap-1.5 self-start rounded px-2.5 font-semibold ${TONE_TAG[w.tone]}`}
                  >
                    <Icon name={TONE_ICON[w.tone]} size={17} />
                    {capitalise(r.name)}
                  </span>
                  <span className={`text-base ${TONE_WORDS[w.tone]}`}>
                    {w.words}
                    {w.upload && (
                      <>
                        {" "}
                        <Link
                          href={`/profile/upload/${r.code}`}
                          aria-label={`Upload your ${r.name}`}
                          className="font-semibold underline underline-offset-4"
                        >
                          upload it
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {facts.meetingPoint && (
          <Fact label="Report to">
            <p className="text-lg font-semibold">{facts.meetingPoint}</p>
          </Fact>
        )}
        {facts.uniform && (
          <Fact label="Bring and wear">
            <BringAndWear text={facts.uniform} />
          </Fact>
        )}
        {facts.payRatePence != null && (
          <PayLine ratePence={facts.payRatePence} startsAt={shift.startsAt} endsAt={shift.endsAt} />
        )}
      </div>
    </section>
  );
}

// The bar that stays at the bottom of the screen, above the tab bar, with what she can do.
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-action-bar=""
      className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-5 animate-bar border-t border-line bg-card px-4 py-3 sm:-mx-6 sm:px-6"
    >
      {children}
    </div>
  );
}

// A plain sentence about the shift, in a grey box.
const stateBox = "rounded-xl bg-quiet-soft p-4 font-semibold";

const openShiftsLink = (
  <Link href="/shifts/open" className={`${staffBtn.primary} mt-4`}>
    See open shifts
  </Link>
);

type Back = { href: string; label: string };
const ALL_OPEN: Back = { href: "/shifts/open", label: "All open shifts" };

function BackLink({ to }: { to: Back }) {
  return (
    <Link
      href={to.href}
      className="-ml-1.5 mb-3 inline-flex min-h-12 items-center gap-1.5 rounded-lg pr-3 pl-1.5 font-semibold text-brand-ink hover:bg-quiet-soft"
    >
      <Icon name="chevron" size={22} className="rotate-180" />
      {to.label}
    </Link>
  );
}

// A shift she can't open in full (filled, started, cancelled): its role and when, and why.
function Short({
  shift,
  timeZone,
  words,
}: {
  shift: ShiftSummary;
  timeZone: string;
  words: string;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  return (
    <>
      <BackLink to={ALL_OPEN} />
      <PageHeader title={roleLabel(shift.role)}>
        <p className="font-semibold tabular-nums">
          {day.dow} {day.day} {day.month}, {t.range}
        </p>
        {shift.site && <p className="text-base text-ink-muted">{shift.site.name}</p>}
      </PageHeader>
      <p className={stateBox}>{words}</p>
      {openShiftsLink}
    </>
  );
}

export function ShiftView({
  page,
  timeZone,
  now,
}: {
  page: ShiftPage;
  timeZone: string;
  now: Date;
}) {
  switch (page.state) {
    case "missing":
      return (
        <>
          <BackLink to={ALL_OPEN} />
          <PageHeader title="This shift isn't available.">
            <p>It may have been removed, or the link is wrong.</p>
          </PageHeader>
          {openShiftsLink}
        </>
      );
    case "booked":
      return (
        <>
          <BackLink to={{ href: "/shifts", label: "Your shifts" }} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={null}
            timeZone={timeZone}
            status={
              <p>
                <StatusChip tone="done">You&apos;re booked on this shift</StatusChip>
              </p>
            }
          />
          {page.shift.instructions && (
            <div className="mt-5 rounded-xl bg-quiet-soft p-4">
              <h2 className="font-semibold">Instructions</h2>
              <p className="mt-1 whitespace-pre-line">{page.shift.instructions}</p>
            </div>
          )}
          <ShiftActions shift={page.shift} now={now} timeZone={timeZone} />
        </>
      );
    case "open":
    case "held":
    case "blocked":
      return (
        <>
          <BackLink to={ALL_OPEN} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={page.shift.placesLeft}
            timeZone={timeZone}
          />
          {page.state === "open" ? (
            <ActionBar>
              <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
              <p className="mt-2 text-base text-ink-muted">
                {strikeNoteText(page.facts.noticeHours)}
              </p>
            </ActionBar>
          ) : page.state === "held" ? (
            <ActionBar>
              <p className="flex items-start gap-2.5 text-base">
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-[5px] bg-hivis text-on-hivis">
                  <Icon name="clock" size={17} />
                </span>
                <span>
                  Offered first to people with fewer hours that week.{" "}
                  <strong className="font-semibold">
                    You can take it from {soonLabel(page.opensAt, now, timeZone)}.
                  </strong>
                </span>
              </p>
              <button
                type="button"
                disabled
                className={`${staffBtn.secondary} mt-2.5 border-dashed`}
              >
                Take shift from {soonLabel(page.opensAt, now, timeZone)}
              </button>
              {/* Reloads this page: from that time it offers "Take shift" (help: "Tap Check again"). */}
              <Link href={`/shifts/${page.shift.shiftId}`} className={`${staffBtn.text} mt-1`}>
                Check again
              </Link>
            </ActionBar>
          ) : (
            <div className="mt-6">
              <Blocked page={page} timeZone={timeZone} />
            </div>
          )}
        </>
      );
    case "filled":
      return <Short shift={page.shift} timeZone={timeZone} words="This shift has been filled." />;
    case "started":
      return (
        <Short shift={page.shift} timeZone={timeZone} words="This shift has already started." />
      );
    case "cancelled":
      return <Short shift={page.shift} timeZone={timeZone} words="This shift was cancelled." />;
  }
}

// The rules said no: their reasons in plain English, then her review request or the form to ask.
function Blocked({
  page,
  timeZone,
}: {
  page: Extract<ShiftPage, { state: "blocked" }>;
  timeZone: string;
}) {
  return (
    <>
      <section
        aria-labelledby="why-heading"
        className="rounded-xl bg-urgent-soft p-4 text-urgent-ink"
      >
        <h2 id="why-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="urgent" size={20} />
          You can&apos;t take this shift:
        </h2>
        <ul className="mt-2 list-disc pl-5">
          {page.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </section>
      {page.review ? (
        <div role="status" className="mt-6">
          <p className="font-semibold">
            You asked the office to review this at {timeOnDay(page.review.askedAt, timeZone)}.
            Reference: {page.review.ref}.
          </p>
          <p className="mt-1">You can see it in My requests.</p>
          <Link href="/requests" className={`${staffBtn.secondary} mt-3`}>
            See my requests
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-6">If you think this is wrong, ask the office to review it.</p>
          <ReviewForm shiftId={page.shift.shiftId} />
        </>
      )}
    </>
  );
}
