import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "../logout-button";
import { RECORD_ROW_LINE } from "../my-shifts-view";
import { Icon, type IconName } from "../ui/icons";
import {
  disc,
  h2,
  headingGap,
  muted,
  nums,
  sectionGap,
  staffBtn,
  staffBtnInline,
  staffCard,
  staffCount,
  staffRows,
  tapRow,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { Slip } from "@/app/ui/slip";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import type { Qualification } from "@/lib/credentials/status";
import type { MyStrikes } from "@/lib/portal/my-strikes";
import {
  myStrikeCancelled,
  myStrikeCountText,
  myStrikeRuleText,
  myStrikesOffText,
  myStrikeSession,
  myStrikesMoreText,
  myStrikeStatus,
  myStrikeTitle,
} from "@/lib/portal/my-strikes-copy";
import type { Profile } from "@/lib/portal/profile";
import { RECORD_PATH, RECORD_TITLE } from "@/lib/portal/record-copy";
import type { MyTravel } from "@/lib/portal/travel";
import { TRAVEL_PATH, TRAVEL_TITLE, travelSummaryText } from "@/lib/portal/travel-copy";
import { MAX_UNAVAILABLE_DAYS, UNAVAILABLE_AHEAD_DAYS } from "@/lib/portal/profile-kinds";
import {
  chipTail,
  meaning,
  noRuleText,
  otherMeaning,
  otherShiftText,
  qualificationTitle,
  rightToWorkText,
  statusLabel,
  STATUS_TONES as QUALIFICATION_TONES,
  WRONG_NUMBER,
} from "@/lib/portal/qualification-copy";
import { PHOTO_GUIDANCE, PHOTO_TONES, PHOTO_WORDS, photoDates } from "@/lib/portal/upload-copy";
import { shortDate } from "@/lib/rules/reasons";
import {
  countsWords,
  LATE_NOTICE_HOURS,
  NEW_RELIABILITY_TEXT,
  NEW_RELIABILITY_WHEN,
  reliabilityWords,
  type Reliability,
} from "@/lib/rules/reliability";
import { addDays } from "@/lib/time/zoned";
import { WhatHappened } from "../shifts/cancel-shift-result";
import { AvailabilityForm } from "./availability-form";
import { EmailText } from "./email-text";
import { Fold } from "./fold";
import { NotificationForm } from "./notification-form";
import { OfficeLinked } from "./office-link";
import { OpenFoldFromLink } from "./open-fold";
import type { LoginWay } from "@/lib/portal/login-way";
import { PushSetting } from "./push-setting";
import { UploadForm } from "./upload-form";

// Me (docs/screens.md, `/profile` and "### 28.11"): My requests, Your shift record (28.13) and Help
// as rows under my name (28.11), contact details (read-only), my staff photo (12F.2: the current one, when it's due again,
// its status and "Upload a new photo", the picture shown before it's sent, 28.11), my
// qualifications as they stand today (12F.1: each status, its date line and what it means; 12F.2:
// "Upload a new one" for the ones I may upload; 28.11: my record's number, and "The office has this
// in hand."; then "Other qualifications on file", Phase 27.2, and right to work), my reliability and
// strikes (12C.5), then folded (28.11): my travel area (12G.1), days I can't work, and how we reach
// me. One card per section; "message the office" is always a link to Messages, never a dead end.

// A worker who replied STOP to a text (docs/screens.md `/profile`): texts are off until START, so
// shift messages go by email if we hold their address, else only as notifications (Phase 26.9),
// and where the firm has phone notifications off, not at all (28.11).
export function textsOffText(email: string | null, push = true): string {
  const how = email
    ? `We'll email shift messages to ${email}.`
    : push
      ? "We can only reach you by notifications on your phone."
      : "We have no other way to send you shift messages.";
  return `Texts are off: you replied STOP to one of our texts. ${how} To turn texts back on, text START to our number.`;
}

// How a message goes when no notification reaches their phone (Phase 26.9): their choice (a text,
// or an email while we hold their address); an email instead of a text when there's no text sender
// or they replied STOP; else no other way.
export function otherWayOf(
  textSender: boolean,
  p: { notifyChannel: "sms" | "email"; email: string | null; textsOff: boolean },
): "text" | "email" | "none" {
  if (p.email && (p.notifyChannel === "email" || !textSender || p.textsOff)) return "email";
  return textSender && !p.textsOff ? "text" : "none";
}

// "07700 900123" from "+447700900123"; other numbers as stored.
export const ukMobile = (e164: string) =>
  /^\+44\d{10}$/.test(e164) ? `0${e164.slice(3, 7)} ${e164.slice(7)}` : e164;

export function ProfileView({
  profile,
  signOff,
  push = null,
  strikes = null,
  travel = null,
  loginWay = "message",
  textSender: textSenderProp,
  answersCount = 0,
}: {
  profile: Profile;
  signOff: string;
  // How their login links and codes go (P2.7; src/lib/portal/login-way.ts): their own case (Phase
  // 26.9: not by text after STOP).
  loginWay?: LoginWay;
  // Whether there's a text sender at all (src/lib/portal/login-way.ts hasTextSender): without one,
  // "How we reach you" has no text to choose and no STOP note. Not their login way: a casual who
  // replied STOP has no text login way, but texts exist and the note must show. Defaults to the
  // login way, for callers that don't say.
  textSender?: boolean;
  // The firm's phone notifications (its VAPID key): with none, "Notifications on this phone" isn't
  // shown at all, and nothing says notifications would come (28.11).
  push?: { publicKey: string | null; firmName: string } | null;
  strikes?: MyStrikes | null;
  travel?: MyTravel | null;
  // The office's answers to her requests she hasn't seen (28.2's count, the tab bar's too).
  answersCount?: number;
}) {
  const year = Number(profile.today.slice(0, 4));
  const textSender = textSenderProp ?? loginWay === "message";
  const pushKey = push?.publicKey ?? null;
  return (
    <>
      <OpenFoldFromLink />
      <PageHeader title={`${profile.firstName} ${profile.lastName}`} />

      {/* Her requests and Help first (28.11: they sat at the very bottom, 4 screens down). */}
      <ul role="list" className={`${staffRows} overflow-hidden`}>
        <TopRow
          href="/requests"
          icon="requests"
          title="My requests"
          sub={answersCount > 0 ? answersText(answersCount) : REQUESTS_LINE}
          count={answersCount}
        />
        {/* Her shift record (28.4), linked from Profile and Booked's Past 90 days (28.13). */}
        <TopRow href={RECORD_PATH} icon="log" title={RECORD_TITLE} sub={RECORD_ROW_LINE} />
        <TopRow href="/help" icon="guide" title="Help" sub={HELP_LINE} />
      </ul>

      <section aria-labelledby="contact-heading" className={`${staffCard} ${sectionGap.staff}`}>
        <h2 id="contact-heading" className={h2}>
          Your details
        </h2>
        <p className={`${headingGap} ${nums}`}>Mobile: {ukMobile(profile.mobile)}</p>
        <p>Email: {profile.email ? <EmailText email={profile.email} /> : "none"}</p>
        <p className={`mt-2 ${muted}`}>To change your name or number, ask the office.</p>
      </section>

      <section aria-labelledby="photo-heading" className={`${staffCard} ${sectionGap.staff}`}>
        <h2 id="photo-heading" className={h2}>
          Staff photo
        </h2>
        <div className={`${headingGap} flex items-center gap-4`}>
          {profile.photo.current ? (
            // An access-checked image of her own (src/app/files/[id]/route.ts), never cached.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/files/${profile.photo.current.id}`}
              alt={`Staff photo of ${profile.firstName} ${profile.lastName}`}
              width={72}
              height={72}
              className="h-18 w-18 shrink-0 rounded-row object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="glass-tile flex h-18 w-18 shrink-0 items-center justify-center rounded-row text-sm text-ink-muted"
            >
              No photo
            </div>
          )}
          <div className="min-w-0">
            <p className={`text-base ${nums}`}>{photoDates(profile.photo, year)}</p>
            <p className="mt-1">
              <StatusChip tone={PHOTO_TONES[profile.photo.status]}>
                {PHOTO_WORDS[profile.photo.status]}
              </StatusChip>
            </p>
          </div>
        </div>
        {profile.photo.waiting && (
          <p className={`mt-3 ${muted} ${nums}`}>
            You sent a new one on {shortDate(profile.photo.waiting.uploadedOn, year)}. Until the
            office checks it, this one stays.
          </p>
        )}
        <UploadForm
          kind="photo"
          camera="user"
          button="Upload a new photo"
          guidance={PHOTO_GUIDANCE}
        />
      </section>

      <section
        aria-labelledby="qualifications-heading"
        className={`${staffCard} ${sectionGap.staff} overflow-hidden`}
      >
        <h2 id="qualifications-heading" className={h2}>
          Qualifications
        </h2>
        {profile.rolesWithoutRule.length > 0 && (
          <p className={headingGap}>{noRuleText(profile.rolesWithoutRule)}</p>
        )}
        {profile.qualifications.length === 0 ? (
          profile.rolesWithoutRule.length === 0 && (
            <p className={headingGap}>Your roles don&apos;t need any.</p>
          )
        ) : (
          <ul
            role="list"
            className={`${headingGap} -mx-4 divide-y divide-line border-t border-line`}
          >
            {profile.qualifications.map((q) => {
              const means = meaning(q);
              return (
                <QualificationRow key={q.type} q={q} year={year}>
                  {/* Her own record's number (28.11), only on one she may upload herself. */}
                  {q.uploadable && q.number && (
                    <>
                      <p className={`mt-2 text-base ${nums}`}>
                        Number: <span className="font-semibold">{q.number}</span>
                      </p>
                      <p className="text-base">
                        <OfficeLinked text={WRONG_NUMBER} />
                      </p>
                    </>
                  )}
                  {means && (
                    <p className="mt-2 text-base">
                      <OfficeLinked text={means} />
                    </p>
                  )}
                  {/* An upload can't lift a suspension; one waiting may be replaced; one the office
                      has in hand needs nothing from her (28.11). */}
                  {q.uploadable && q.status !== "suspended" && !q.inHand && (
                    <p className="mt-3">
                      <Link href={`/profile/upload/${q.type}`} className={staffBtnInline}>
                        Upload a new one
                      </Link>
                    </p>
                  )}
                </QualificationRow>
              );
            })}
          </ul>
        )}
        {/* One a shift of hers needs on top of its role (Phase 27.2): no upload here (her upload
            page takes only what her roles need), so what to tell the office instead. */}
        {profile.others && profile.others.length > 0 && (
          <div className="-mx-4 border-t border-line">
            <h3
              id="other-qualifications-heading"
              className="px-4 pt-3 text-lg font-semibold text-ink"
            >
              Other qualifications on file
            </h3>
            <ul
              role="list"
              aria-labelledby="other-qualifications-heading"
              className="mt-2 divide-y divide-line border-t border-line"
            >
              {profile.others.map((q) => {
                const means = otherMeaning(q);
                return (
                  <QualificationRow key={q.type} q={q} year={year}>
                    <p className="mt-2 text-base">{otherShiftText(q.shift)}</p>
                    {means && (
                      <p className="mt-1 text-base">
                        <OfficeLinked text={means} />
                      </p>
                    )}
                  </QualificationRow>
                );
              })}
            </ul>
          </div>
        )}
        <div className="-mx-4 -mb-4 border-t border-line px-4 py-3">
          <p className="font-semibold">Right to work</p>
          <p className={`mt-1 text-base ${nums}`}>{rightToWorkText(profile.rightToWork, year)}</p>
        </div>
      </section>

      {profile.reliability && <ReliabilitySection reliability={profile.reliability} />}

      {/* With strikes off and none given before, there's nothing to say (P3.4). */}
      {strikes && (strikes.enabled || strikes.strikes.length > 0) && (
        <StrikesSection strikes={strikes} />
      )}

      {/* The settings, folded (28.11): each its heading and how it stands; a tap opens it. */}
      {travel && (
        <Fold headingId="travel-heading" title={TRAVEL_TITLE} state={travelSummaryText(travel)}>
          <Link href={TRAVEL_PATH} className={staffBtn.secondary}>
            {travel.set ? "Change your travel area" : "Set your travel area"}
          </Link>
        </Fold>
      )}

      <Fold
        headingId="days-heading"
        title="Days you can't work"
        state={daysMarkedText(profile.unavailable.length)}
      >
        <p className={muted}>
          We won&apos;t offer you shifts on these days. You can mark up to {MAX_UNAVAILABLE_DAYS}{" "}
          days, up to 6 months ahead.
        </p>
        <AvailabilityForm
          signOff={signOff}
          days={profile.unavailable}
          min={profile.today}
          max={addDays(profile.today, UNAVAILABLE_AHEAD_DAYS)}
        />
      </Fold>

      {/* Open from the start when texts are off, so the STOP note shows straight away. */}
      <Fold
        headingId="notify-heading"
        title="How we reach you"
        state={alertsText(profile.offerAlerts)}
        open={textSender && profile.textsOff}
      >
        {textSender && profile.textsOff && (
          <Slip tone="attention" role="note">
            <p>{textsOffText(profile.email, pushKey !== null)}</p>
          </Slip>
        )}
        <NotificationForm
          channel={profile.notifyChannel}
          offerAlerts={profile.offerAlerts}
          textsOff={profile.textsOff}
          loginWay={loginWay}
          textSender={textSender}
          push={pushKey !== null}
          email={profile.email}
          signOff={signOff}
        />
        {/* Only where the firm has phone notifications (28.11: nothing about a feature that's off). */}
        {push && pushKey && (
          <PushSetting
            publicKey={pushKey}
            firmName={push.firmName}
            otherWay={otherWayOf(textSender, profile)}
          />
        )}
      </Fold>

      {/* Last, Log out (docs/office-v2.md 4.1; 12H.1). */}
      <div className="mt-8 border-t border-line pt-8">
        <LogoutButton
          kind="worker"
          after="/login?out=1"
          className={`${staffBtn.secondary} w-full`}
          icon={<Icon name="logout" />}
        />
      </div>
    </>
  );
}

// The top rows' second lines (28.11).
export const REQUESTS_LINE = "What you've asked the office, and their answers";
export const HELP_LINE = "How booking, cancelling and pay work";
export const answersText = (n: number) =>
  n === 1 ? "1 new answer from the office" : `${n} new answers from the office`;
// What a shut fold says of how it stands (28.11).
export const daysMarkedText = (n: number) =>
  n === 0 ? "No days marked" : n === 1 ? "1 day marked" : `${n} days marked`;
export const alertsText = (on: boolean) => (on ? "Open-shift alerts on" : "Open-shift alerts off");

// One of the top rows: a round disc, the words, a chevron; the whole row is the link (80px, as
// Home's rows). A count of new answers beside its title, said in words on the line under it.
function TopRow({
  href,
  icon,
  title,
  sub,
  count = 0,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub: string;
  count?: number;
}) {
  return (
    <li>
      <Link href={href} className={`${tapRow} press min-h-20 px-4`}>
        <span aria-hidden="true" className={`${disc.base} ${disc.quiet}`}>
          <Icon name={icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-snug font-medium text-ink">
            {title}
            {count > 0 && (
              <span aria-hidden="true" className={staffCount}>
                {count}
              </span>
            )}
          </span>{" "}
          <span className="block text-base text-ink-muted">{sub}</span>
        </span>
        <Icon name="chevron" size={22} className="text-ink-muted" />
      </Link>
    </li>
  );
}

// One qualification, as a row running to the card's edges: its name, its status chip and date
// ("Valid until 27 Mar 2028"), then what follows (`children`). One that stops her working is red,
// with a red edge.
function QualificationRow({
  q,
  year,
  children,
}: {
  q: Qualification;
  year: number;
  children: ReactNode;
}) {
  const blocked = q.status === "expired" || q.status === "suspended" || q.status === "rejected";
  return (
    <li
      className={
        blocked
          ? "border-l-4 border-urgent bg-urgent-soft py-3 pr-4 pl-3 text-urgent-ink"
          : "px-4 py-3"
      }
    >
      <p className="font-semibold">{qualificationTitle(q.name)}</p>
      <p className={`mt-1 text-base ${nums}`}>
        <StatusChip tone={QUALIFICATION_TONES[q.status]}>{statusLabel(q)}</StatusChip>
        {chipTail(q, year)}
      </p>
      {children}
    </li>
  );
}

// Strikes (docs/office-v2.md 4.6): how many still count, the rule, and each strike with where it
// stands; "Tell us what happened" under one that still counts. Never the office's reasons.
const STRIKE_TONE = (s: MyStrikes["strikes"][number]): StatusTone =>
  s.status === "withdrawn" ? "done" : s.counting ? "urgent" : "quiet";

function StrikesSection({ strikes }: { strikes: MyStrikes }) {
  const tz = strikes.timeZone;
  // "Tell us what happened" once per session: under its newest strike, while that still counts.
  const newest = new Set<string>();
  const tellUs = strikes.strikes.map((s) => {
    const first = !newest.has(s.shiftId);
    newest.add(s.shiftId);
    return first && s.counting;
  });
  return (
    <section
      aria-labelledby="strikes-heading"
      className={`${staffCard} ${sectionGap.staff} overflow-hidden`}
    >
      <h2 id="strikes-heading" className={h2}>
        Strikes
      </h2>
      <p className={`${headingGap} font-semibold`}>
        {myStrikeCountText(strikes.counting, strikes.liveDays)}
      </p>
      <p className={`mt-1 ${muted}`}>
        {strikes.enabled
          ? myStrikeRuleText(strikes.noticeHours)
          : myStrikesOffText(strikes.liveDays)}
      </p>
      {strikes.more && (
        <p className={`mt-1 ${muted}`}>{myStrikesMoreText(strikes.strikes.length)}</p>
      )}
      {strikes.strikes.length > 0 && (
        <ul
          role="list"
          className={`${headingGap} -mx-4 -mb-4 divide-y divide-line border-t border-line`}
        >
          {strikes.strikes.map((s, i) => (
            <li key={`${s.shiftId}:${s.cancelledAt.toISOString()}`} className="px-4 py-3">
              <p className="font-semibold">{myStrikeTitle(s)}</p>
              <p className={`text-base ${nums}`}>{myStrikeSession(s, tz)}</p>
              <p className={`text-base ${nums}`}>{myStrikeCancelled(s, tz)}</p>
              <p className={`mt-1 text-base ${nums}`}>
                <StatusChip tone={STRIKE_TONE(s)}>{myStrikeStatus(s, tz)}</StatusChip>
              </p>
              {tellUs[i] && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">Tell us what happened</summary>
                  <div className="mt-2">
                    <WhatHappened shiftId={s.shiftId} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Their own reliability (Phase 26.7, cas-6): the same figure and counts the office sees. The
// notice is the reliability rule's own (LATE_NOTICE_HOURS), not the firm's strike notice: the count
// uses it (src/lib/office/reliability.ts).
function ReliabilitySection({ reliability }: { reliability: Reliability }) {
  return (
    <section aria-labelledby="reliability-heading" className={`${staffCard} ${sectionGap.staff}`}>
      <h2 id="reliability-heading" className={h2}>
        Your reliability
      </h2>
      <p className={`${headingGap} text-lg`}>
        {reliability.kind === "figure" ? (
          <>
            <span className="font-semibold">{reliabilityWords(reliability)}</span> over the last 90
            days
          </>
        ) : (
          <>
            <span className="font-semibold">{NEW_RELIABILITY_TEXT}</span> {NEW_RELIABILITY_WHEN}
          </>
        )}
      </p>
      <p className="mt-1 text-base text-ink-muted tabular-nums">
        {countsWords(reliability.counts)}
      </p>
      <p className="mt-2 text-base">
        Shifts you worked, out of those plus no-shows and cancellations with under{" "}
        {LATE_NOTICE_HOURS} hours&apos; notice. The office sees the same figure. It doesn&apos;t
        change which shifts you&apos;re offered.
      </p>
    </section>
  );
}
