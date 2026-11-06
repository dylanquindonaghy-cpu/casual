import Link from "next/link";
import type { ReactNode } from "react";
import { mapLink, roleLabel, siteAddress, soonLabel, timeOnDay } from "@/lib/portal/format";
import { messageOfficeHref } from "@/lib/portal/message-office";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import {
  ADD_TO_CALENDAR,
  bookedLinks,
  type BookedLinks,
  CALENDAR_AGAIN,
  changedSinceText,
  MESSAGE_OFFICE,
  NO_PAY_YET,
  payAsk,
  reasonsNeedOffice,
  requirementWords,
  RUNNING_LATE,
  strikeNote,
  travelSentence,
} from "@/lib/portal/shift-page-copy";
import { dateParts, placesLeftText, timeRange } from "@/lib/portal/sign-copy";
import { hoursText } from "@/lib/portal/pay-format";
import { wallTimeOf } from "@/lib/time/zoned";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import { ShiftActions } from "../../my-shifts-view";
import { btn, chip, staffBtn, tag } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { Seats } from "../../ui/seats";
import { DateTile } from "../../ui/sign";
import { Slip } from "../../ui/slip";
import { StatusChip } from "../../ui/status-chip";
import { AskButton } from "../open/ask-button";
import { AskedNote, NotThisTimeNote } from "../open/ask-result";
import { TakeShiftButton } from "../open/take-shift-button";
import { BringAndWear, PayFigures, TravelFigures } from "../shift-parts";
import { ReviewForm } from "./review-form";

// One shift's page (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]` and "The casual app,
// Phase 28" 28.5; 12H.2; Phases 18, 20, 24 and 28). Its own bar at the top with the way back and
// the firm's mark and name (the firm's bar hides, and there's no tab bar), frosting once the page
// scrolls under it; a glass card opened by the urgent slip ("Urgent, needed now") when it is, the
// time large beside the date tile (pale red when urgent), the day and how long, the role (the
// page's heading), the place and its address with the post on a plate; then a glass card each for
// getting there from her travel area (three figures, or the travel line's one sentence until the
// times are worked out; then "Directions"), the places as seats with their words on a tag ("The
// last place"), what it needs (each with her status, "upload it" where she can send it herself and
// "Message the office" where only the office can sort it), where to report, what to bring and
// wear, and the pay with its estimate ("Not given yet." and "Ask the office about the pay" when
// the session has no rate). Under them what she can do: "Take shift" floating at the foot over a
// frosted strip, the strike note under it ("You're booked." then covers the screen); when it opens
// (fair rotation); the rules' reasons with "Message the office" for the ones only the office can
// sort, and "Ask the office to review"; or, booked: what changed since she booked, "Running
// late?", "Message the office" once it has started, "Add to my calendar", her instructions and
// actions. Filled, started and cancelled say so. Every way to the office is a link built from
// 28.2's contract (src/lib/portal/message-office.ts); nothing here changes anything by itself.

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

// The firm whose shift it is, beside the way back (the review's note 16: an offer's link lands
// here, and the firm's own bar hides).
export interface FirmMark {
  name: string;
  logoUrl: string | null;
}

// A glass card of the shift's page with its heading: a section's 12px round, 16px inside (28.1).
function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass flex flex-col gap-3 rounded-inner p-4">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

// A full-width link to the office (Messages about this shift, or the pay query), 52px tall.
function OfficeLink({
  href,
  icon = "messages",
  children,
}: {
  href: string;
  icon?: "messages" | "clock";
  children: ReactNode;
}) {
  return (
    <Link href={href} className={staffBtn.secondary}>
      <Icon name={icon} size={22} />
      {children}
    </Link>
  );
}

function ShiftCard({
  shift,
  facts,
  placesLeft,
  timeZone,
  now,
  status,
  after,
}: {
  shift: ShiftSummary | MyShift;
  facts: ShiftFacts;
  placesLeft: number | null;
  timeZone: string;
  now: Date;
  status?: ReactNode;
  after?: ReactNode; // under the shift's card, before the facts (her booking's links)
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  const hours = Math.max(0, shift.endsAt.getTime() - shift.startsAt.getTime()) / 3_600_000;
  const address = shift.site ? siteAddress(shift.site) : null;
  const map = shift.site ? mapLink(shift.site) : null;
  const year = wallTimeOf(shift.startsAt, timeZone).year;
  const session = { id: shift.shiftId, endsAt: shift.endsAt };
  const officeHref = messageOfficeHref(session, "other", now);
  const needs = facts.requirements.map((r) => ({
    r,
    w: requirementWords(r.status, { lastDay: facts.lastDay, year, uploadable: r.uploadable }),
  }));
  const where = [facts.eventName, shift.site?.name].filter(Boolean).join(" · ");
  const sentence = facts.travel ? travelSentence(facts.travel, timeZone) : null;
  const ask = payAsk(session, now);
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="shift-heading" className="glass animate-open rounded-inner">
        <div className="flex flex-col gap-4 p-4">
          {/* The office's urgent notice (28.1's slip) in place of round 7's solid red band. */}
          {facts.isUrgent && <Slip tone="urgent" title="Urgent, needed now" />}
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
          {/* No chips of what it needs here: "You need" below lists each with her status (the
              review's note 13), so they would only repeat it. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg leading-snug text-ink">{where || roleLabel(shift.role)}</p>
              {address && <p className="text-base text-ink-muted">{address}</p>}
            </div>
            {facts.post && (
              <span className="glass-button shrink-0 rounded-row px-3 py-1.5 text-lg font-medium text-ink">
                {facts.post}
              </span>
            )}
          </div>
          {status}
        </div>
      </section>
      {after}
      {(facts.travel || map) && (
        <Card
          id="getting-there-heading"
          title={`Getting there${facts.travel ? ", from your travel area" : ""}`}
        >
          {facts.travel &&
            (sentence ? (
              // Not worked out yet: the travel line's one sentence (line-copy.ts), not figures.
              <p data-travel-line="" className="text-lg text-ink">
                {sentence}
              </p>
            ) : (
              <TravelFigures travel={facts.travel} timeZone={timeZone} />
            ))}
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className={staffBtn.secondary}>
              <Icon name="map" size={22} />
              Directions
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
            <span
              data-places-left=""
              className={facts.isUrgent ? `${chip.base} ${chip.urgent}` : tag}
            >
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
                  {w.upload && !r.anyOf && (
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
                  {/* A group she holds none of (25.2): either will do, so a link for each. */}
                  {w.upload && r.anyOf && (
                    <>
                      {" "}
                      upload{" "}
                      {r.anyOf
                        .filter((a) => a.uploadable)
                        .map((a, i, all) => (
                          <span key={a.code}>
                            {i > 0 && (i === all.length - 1 ? " or " : ", ")}
                            <Link
                              href={`/profile/upload/${a.code}`}
                              aria-label={`Upload your ${a.name}`}
                              className="font-semibold underline underline-offset-4"
                            >
                              {a.name}
                            </Link>
                          </span>
                        ))}
                    </>
                  )}
                  {/* Only the office can sort it (28.5: no more "ask the office." with no way to). */}
                  {w.message && (
                    <>
                      {" "}
                      <Link
                        href={officeHref}
                        aria-label={`${MESSAGE_OFFICE} about your ${r.name}`}
                        className={btn.link}
                      >
                        {MESSAGE_OFFICE}
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
      <Card id="pay-heading" title="Pay">
        {facts.payRatePence != null ? (
          <PayFigures
            ratePence={facts.payRatePence}
            startsAt={shift.startsAt}
            endsAt={shift.endsAt}
          />
        ) : (
          <>
            <p className="text-lg text-ink">{NO_PAY_YET}</p>
            {/* The review's major 2: a way to ask. A worked shift's goes to payroll (rule 9). */}
            <OfficeLink href={ask.href}>{ask.label}</OfficeLink>
          </>
        )}
      </Card>
    </div>
  );
}

// Her booking's links, under the shift's card (28.5): "Running late?" from 3 hours before the
// start, "Message the office" once it has started, and "Add to my calendar" until it ends (a plain
// download of /shifts/{id}/calendar, never a page), with "The times changed. Add it to your
// calendar again." when the office moved it since she booked.
function BookingLinks({ links, timesChanged }: { links: BookedLinks; timesChanged: boolean }) {
  if (!links.late && !links.started && !links.calendar) return null;
  return (
    <div data-booking-links="" className="flex flex-col gap-2.5">
      {links.late && (
        <OfficeLink href={links.late} icon="clock">
          {RUNNING_LATE}
        </OfficeLink>
      )}
      {links.started && <OfficeLink href={links.started}>{MESSAGE_OFFICE}</OfficeLink>}
      {links.calendar && timesChanged && (
        <Slip tone="attention" role="note">
          <p>{CALENDAR_AGAIN}</p>
        </Slip>
      )}
      {links.calendar && (
        <a href={links.calendar} download className={staffBtn.secondary}>
          <Icon name="shifts" size={22} />
          {ADD_TO_CALENDAR}
        </a>
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

// A plain sentence about the shift, in a grey box (8px round, 28.1).
const stateBox = "rounded-row bg-quiet-soft p-4 font-semibold";

const openShiftsLink = (
  <Link href="/shifts/open" className={`${staffBtn.primary} mt-4`}>
    See open shifts
  </Link>
);

type Back = { href: string; label: string };
const ALL_OPEN: Back = { href: "/shifts/open", label: "Open shifts" };

// The firm's mark (its logo, or its initial on its colour, 8px round as the firm's bar has it) and
// its name, at the end of the page's own bar.
function FirmName({ firm }: { firm: FirmMark }) {
  const initial = firm.name.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";
  return (
    <span data-firm="" className="flex min-w-0 items-center gap-2">
      {firm.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a firm's own https logo, from any host (as the firm's bar shows it)
        <img
          src={firm.logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-auto max-w-24 object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-row bg-brand-bar text-sm font-bold text-on-brand-bar"
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 truncate text-base font-semibold text-ink">{firm.name}</span>
    </span>
  );
}

// The page's own bar at the top, with the way back and (28.5) the firm's mark and name: it stays
// at the top once the page runs and frosts when the page scrolls under it (`scroll-edge`), as the
// firm's bar does; the firm's bar hides while it's here (`data-own-bar`: src/app/brand-bar.tsx).
function BackBar({ to, firm }: { to: Back; firm?: FirmMark }) {
  return (
    <div
      data-own-bar=""
      className="scroll-edge relative z-20 -mx-4 -mt-6 mb-2 flex items-center justify-between gap-3 px-4 pt-1 sm:-mx-6 sm:px-6 [html[data-js]_&]:sticky [html[data-js]_&]:top-0"
    >
      <Link
        href={to.href}
        className="-ml-2 inline-flex min-h-14 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1.5 text-lg font-medium text-ink hover:text-ink-muted"
      >
        <Icon name="chevron" size={22} className="rotate-180" />
        {to.label}
      </Link>
      {firm && <FirmName firm={firm} />}
    </div>
  );
}

// A shift she can't open in full (filled, started, cancelled): its role and when, and why.
function Short({
  shift,
  timeZone,
  words,
  firm,
}: {
  shift: ShiftSummary;
  timeZone: string;
  words: string;
  firm?: FirmMark;
}) {
  const day = dateParts(shift.startsAt, timeZone);
  const t = timeRange(shift.startsAt, shift.endsAt, timeZone);
  return (
    <>
      <BackBar to={ALL_OPEN} firm={firm} />
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
  firm,
}: {
  page: ShiftPage;
  timeZone: string;
  now: Date;
  firm?: FirmMark;
}) {
  switch (page.state) {
    case "missing":
      return (
        <>
          <BackBar to={ALL_OPEN} firm={firm} />
          <PageHeader title="This shift isn't available.">
            <p>It may have been removed, or the link is wrong.</p>
          </PageHeader>
          {openShiftsLink}
        </>
      );
    case "booked": {
      const links = bookedLinks(
        {
          id: page.shift.shiftId,
          startsAt: page.shift.startsAt,
          endsAt: page.shift.endsAt,
          status: page.shift.status,
        },
        now,
      );
      const changed = page.changes ? changedSinceText(page.changes, timeZone) : null;
      return (
        <>
          <BackBar to={{ href: "/shifts", label: "Your shifts" }} firm={firm} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={null}
            timeZone={timeZone}
            now={now}
            status={
              <>
                <p>
                  <StatusChip tone="done">You&apos;re booked on this shift</StatusChip>
                </p>
                {changed && (
                  <Slip tone="attention" role="note">
                    <p data-changed-since="">{changed}</p>
                  </Slip>
                )}
              </>
            }
            after={<BookingLinks links={links} timesChanged={page.timesChanged === true} />}
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
    }
    case "open":
    case "held":
    case "blocked":
      return (
        <>
          <BackBar to={ALL_OPEN} firm={firm} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={page.shift.placesLeft}
            timeZone={timeZone}
            now={now}
          />
          {page.state === "open" ? (
            <ActionBar>
              <TakeShiftButton shiftId={page.shift.shiftId} onShiftPage />
              {page.facts.strikesOn && (
                <p className="mt-2 text-center text-base text-ink-muted">
                  {strikeNote({
                    startsAt: page.shift.startsAt,
                    now,
                    noticeHours: page.facts.noticeHours,
                  })}
                </p>
              )}
            </ActionBar>
          ) : page.state === "held" ? (
            <ActionBar>
              <p className="flex items-start gap-2.5 text-base">
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-hivis text-on-hivis">
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
              <Blocked page={page} timeZone={timeZone} now={now} />
            </div>
          )}
        </>
      );
    case "ask":
      return (
        <>
          <BackBar to={ALL_OPEN} firm={firm} />
          <ShiftCard
            shift={page.shift}
            facts={page.facts}
            placesLeft={page.shift.placesLeft}
            timeZone={timeZone}
            now={now}
          />
          <ActionBar>
            {page.ask.status === "asked" ? (
              <AskedNote at={timeOnDay(page.ask.askedAt, timeZone)} />
            ) : page.ask.status === "not_this_time" ? (
              <NotThisTimeNote />
            ) : (
              <>
                <p className="mb-2.5 text-base">
                  The office chooses who works this one. Ask for it, and we&apos;ll message you when
                  they decide.
                </p>
                <AskButton shiftId={page.shift.shiftId} />
              </>
            )}
          </ActionBar>
        </>
      );
    case "filled":
      return (
        <Short
          shift={page.shift}
          timeZone={timeZone}
          words="This shift has been filled."
          firm={firm}
        />
      );
    case "started":
      return (
        <Short
          shift={page.shift}
          timeZone={timeZone}
          words="This shift has already started."
          firm={firm}
        />
      );
    case "cancelled":
      return (
        <Short
          shift={page.shift}
          timeZone={timeZone}
          words="This shift was cancelled."
          firm={firm}
        />
      );
  }
}

// The rules said no: their reasons in plain English (the office reads the same words), "Message
// the office" under the ones only the office can sort (28.5), then her review request or the form.
function Blocked({
  page,
  timeZone,
  now,
}: {
  page: Extract<ShiftPage, { state: "blocked" }>;
  timeZone: string;
  now: Date;
}) {
  return (
    <>
      <section
        aria-labelledby="why-heading"
        className="rounded-row border border-urgent-line bg-urgent-soft p-4 text-urgent-ink"
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
        {reasonsNeedOffice(page.codes) && (
          <div className="mt-3">
            <OfficeLink
              href={messageOfficeHref(
                { id: page.shift.shiftId, endsAt: page.shift.endsAt },
                "other",
                now,
              )}
            >
              {MESSAGE_OFFICE}
            </OfficeLink>
          </div>
        )}
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
