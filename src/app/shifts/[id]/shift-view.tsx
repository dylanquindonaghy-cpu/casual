import Link from "next/link";
import type { ReactNode } from "react";
import { mapLink, roleLabel, siteAddress, soonLabel, timeOnDay } from "@/lib/portal/format";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import { requirementWords, strikeNoteText } from "@/lib/portal/shift-page-copy";
import { dateParts, placesLeftText, timeRange } from "@/lib/portal/sign-copy";
import { hoursText } from "@/lib/portal/pay-format";
import { wallTimeOf } from "@/lib/time/zoned";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { ShiftActions } from "../../my-shifts-view";
import { staffBtn } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { Seats } from "../../ui/seats";
import { DateTile } from "../../ui/sign";
import { StatusChip } from "../../ui/status-chip";
import { TakeShiftButton } from "../open/take-shift-button";
import { BringAndWear, PayFigures, TravelFigures } from "../shift-parts";
import { ReviewForm } from "./review-form";

// One shift's page (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]`; 12H.2; Phases 18, 20
// and 24). As round 7 of the canvas has it (24.6): its own bar at the top with the way back (the
// firm's bar hides, and there's no tab bar), frosting once the page scrolls under it; a glass card
// topped by "Urgent, needed now" on a red band when it is, the time large beside the date tile
// (pale red when urgent), the day and how long, the role (the page's heading), chips (Urgent and
// what it needs), the place and its address with the post on a plate; then a glass card each for
// getting there from her home area (three figures and "Open in maps"), the places as seats ("1 of
// 4 places left"), what it needs (each with her status, and where she can sort one herself,
// "upload it"), where to report, what to bring and wear, and the pay with its estimate. Under them
// what she can do: "Take shift" floating at the foot over a frosted strip, the strike note under it
// ("You're booked." then covers the screen); when it opens (fair rotation); the rules' reasons with
// "Ask the office to review"; or, booked, her instructions and actions. Filled, started and
// cancelled say so.

const capitalise = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

// A requirement's status: a circle with its mark, and its words.
const TONE_MARK = {
  done: "bg-done-tile text-done-ink",
  attention: "bg-hivis text-on-hivis",
  urgent: "bg-urgent-tile text-urgent-ink",
} as const;
const TONE_WORDS = {
  done: "text-ink-muted",
  attention: "text-attention-ink",
  urgent: "font-semibold text-urgent-ink",
} as const;
const TONE_ICON = { done: "check", attention: "clock", urgent: "urgent" } as const;

// A glass card of the shift's page with its heading.
function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass flex flex-col gap-3 rounded-3xl p-5">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

// A little glass chip under the role ("Urgent", "SIA DS").
const chip = "glass-tile rounded-[10px] px-2.5 py-1 text-base font-medium";

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
  const hours = Math.max(0, shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  const year = wallTimeOf(shift.startsAt, timeZone).year;
  const needs = facts.requirements.map((r) => ({
    r,
    w: requirementWords(r.status, { lastDay: facts.lastDay, year, uploadable: r.uploadable }),
  }));
  const where = [facts.eventName, shift.site?.name].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="shift-heading"
        className="glass animate-open overflow-hidden rounded-3xl"
      >
        {facts.isUrgent && (
          <p className="flex items-center gap-2.5 bg-urgent-fill px-5 py-3 text-lg font-medium text-on-urgent">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-current" />
            Urgent, needed now
          </p>
        )}
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3.5">
            <DateTile dow={day.dow} day={day.day} month={day.month} urgent={facts.isUrgent} />
            <div className="min-w-0">
              <p className="font-sign text-3xl whitespace-nowrap text-ink">{t.range}</p>
              <p className="text-base text-ink-muted">
                {day.long} · {hoursText(hours)}
              </p>
              {t.endsNote && <p className="text-base text-ink-muted">{t.endsNote}</p>}
            </div>
          </div>
          <h1 id="shift-heading" className="text-3xl font-semibold tracking-heading text-ink">
            {roleLabel(shift.role)}
          </h1>
          {(facts.isUrgent || facts.requirements.length > 0) && (
            <p className="-mt-1 flex flex-wrap gap-2" data-requirements="">
              {facts.isUrgent && <span className={`${chip} text-urgent-ink`}>Urgent</span>}
              {facts.requirements.length > 0 && <span className="sr-only">Needs: </span>}
              {facts.requirements.map((r, i) => (
                <span key={r.code} className={`${chip} text-ink`}>
                  {r.chip}
                  {i < facts.requirements.length - 1 && <span className="sr-only">,</span>}
                </span>
              ))}
            </p>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg leading-snug text-ink">{where || roleLabel(shift.role)}</p>
              {address && <p className="text-base text-ink-muted">{address}</p>}
            </div>
            {facts.post && (
              <span className="glass-tile shrink-0 rounded-[10px] px-3 py-1.5 text-lg font-medium text-ink">
                {facts.post}
              </span>
            )}
          </div>
          {status}
        </div>
      </section>
      {(facts.travel || map) && (
        <Card
          id="getting-there-heading"
          title={`Getting there${facts.travel ? ", from your home area" : ""}`}
        >
          {facts.travel && <TravelFigures travel={facts.travel} timeZone={timeZone} />}
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtn.secondary}>
              <Icon name="map" size={22} />
              Open in maps
            </a>
          )}
        </Card>
      )}
      {placesLeft !== null && (
        <Card id="places-heading" title="Places">
          <p className="flex flex-wrap items-center gap-4">
            <Seats
              taken={facts.headcount - placesLeft}
              total={facts.headcount}
              size="xl"
              urgent={facts.isUrgent}
            />
            <span className="text-lg font-medium text-ink">
              {placesLeftText(placesLeft, facts.headcount)}
            </span>
          </p>
        </Card>
      )}
      {needs.length > 0 && (
        <Card id="needs-heading" title="You need">
          <ul role="list" className="flex flex-col gap-2.5">
            {needs.map(({ r, w }) => (
              <li key={r.code} data-requirement={r.code} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-lg font-medium">
                  <span
                    aria-hidden="true"
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full ${TONE_MARK[w.tone]}`}
                  >
                    <Icon name={TONE_ICON[w.tone]} size={16} />
                  </span>
                  {capitalise(r.name)}
                </span>
                <span className={`pl-8 text-base ${TONE_WORDS[w.tone]}`}>
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
        </Card>
      )}
      {facts.meetingPoint && (
        <Card id="report-heading" title="Report to">
          <p className="text-lg">{facts.meetingPoint}</p>
        </Card>
      )}
      {facts.uniform && (
        <Card id="wear-heading" title="Bring and wear">
          <BringAndWear text={facts.uniform} />
        </Card>
      )}
      {facts.payRatePence != null && (
        <Card id="pay-heading" title="Pay">
          <PayFigures
            ratePence={facts.payRatePence}
            startsAt={shift.startsAt}
            endsAt={shift.endsAt}
          />
        </Card>
      )}
    </div>
  );
}

// What she can do, floating at the foot of the screen over a soft frosted strip (no tab bar on a
// shift's page). At the end of the page it rests in its place.
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-action-bar=""
      className="foot-edge sticky bottom-0 z-10 -mx-4 mt-5 -mb-6 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6"
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
const ALL_OPEN: Back = { href: "/shifts/open", label: "Open shifts" };

// The page's own bar at the top, with the way back: it stays at the top once the page runs and
// frosts when the page scrolls under it (`scroll-edge`), as the firm's bar does; the firm's bar
// hides while it's here (`data-own-bar`: src/app/brand-bar.tsx).
function BackBar({ to }: { to: Back }) {
  return (
    <div
      data-own-bar=""
      className="scroll-edge relative z-20 -mx-4 -mt-6 mb-2 px-4 pt-1 sm:-mx-6 sm:px-6 [html[data-js]_&]:sticky [html[data-js]_&]:top-0"
    >
      <Link
        href={to.href}
        className="-ml-2 inline-flex min-h-14 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-lg font-medium text-ink hover:text-ink-muted"
      >
        <Icon name="chevron" size={22} className="rotate-180" />
        {to.label}
      </Link>
    </div>
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
      <BackBar to={ALL_OPEN} />
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
          <BackBar to={ALL_OPEN} />
          <PageHeader title="This shift isn't available.">
            <p>It may have been removed, or the link is wrong.</p>
          </PageHeader>
          {openShiftsLink}
        </>
      );
    case "booked":
      return (
        <>
          <BackBar to={{ href: "/shifts", label: "Your shifts" }} />
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
            <div className="mt-4">
              <Card id="instructions-heading" title="Instructions">
                <p className="text-lg whitespace-pre-line">{page.shift.instructions}</p>
              </Card>
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
          <BackBar to={ALL_OPEN} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={page.shift.placesLeft}
            timeZone={timeZone}
          />
          {page.state === "open" ? (
            <ActionBar>
              <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
              <p className="mt-2 text-center text-base text-ink-muted">
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
