import Link from "next/link";
import { LogoutButton } from "../logout-button";
import { Icon } from "../ui/icons";
import {
  btn,
  h2,
  headingGap,
  muted,
  nums,
  sectionGap,
  staffBtn,
  staffCard,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import type { MyStrikes } from "@/lib/portal/my-strikes";
import {
  myStrikeCancelled,
  myStrikeCountText,
  myStrikeRuleText,
  myStrikeSession,
  myStrikesMoreText,
  myStrikeStatus,
  myStrikeTitle,
} from "@/lib/portal/my-strikes-copy";
import type { Profile } from "@/lib/portal/profile";
import type { MyTravel } from "@/lib/portal/travel";
import { TRAVEL_PATH, TRAVEL_TITLE, travelSummaryText } from "@/lib/portal/travel-copy";
import { MAX_UNAVAILABLE_DAYS, UNAVAILABLE_AHEAD_DAYS } from "@/lib/portal/profile-kinds";
import {
  dateLine,
  meaning,
  noRuleText,
  qualificationTitle,
  rightToWorkText,
  statusLabel,
  STATUS_TONES as QUALIFICATION_TONES,
} from "@/lib/portal/qualification-copy";
import { PHOTO_GUIDANCE, PHOTO_TONES, PHOTO_WORDS, photoDates } from "@/lib/portal/upload-copy";
import { shortDate } from "@/lib/rules/reasons";
import { addDays } from "@/lib/time/zoned";
import { WhatHappened } from "../shifts/cancel-shift-result";
import { AvailabilityForm } from "./availability-form";
import { NotificationForm } from "./notification-form";
import { PushSetting } from "./push-setting";
import { UploadForm } from "./upload-form";

// Me (docs/screens.md, `/profile`): contact details (read-only), my staff photo (12F.2: the current
// one, when it's due again, its status and "Upload a new photo"), my qualifications as they stand
// today (12F.1: each status, its date line and what it means, then right to work; 12F.2: "Upload a
// certificate" for the ones I may upload), where I work (12G.1), my strikes (12C.5), days I can't
// work, and how we reach me. One card per section.

// A worker who replied STOP to a text (docs/screens.md `/profile`): texts are off until START.
export const TEXTS_OFF =
  "Texts are off: you replied STOP to one of our texts. We'll send shift messages by WhatsApp. To turn texts back on, text START to our number.";

// "07700 900123" from "+447700900123"; other numbers as stored.
export const ukMobile = (e164: string) =>
  /^\+44\d{10}$/.test(e164) ? `0${e164.slice(3, 7)} ${e164.slice(7)}` : e164;

export function ProfileView({
  profile,
  signOff,
  push = null,
  strikes = null,
  travel = null,
}: {
  profile: Profile;
  signOff: string;
  push?: { publicKey: string | null; firmName: string } | null;
  strikes?: MyStrikes | null;
  travel?: MyTravel | null;
}) {
  const year = Number(profile.today.slice(0, 4));
  return (
    <>
      <PageHeader title={`${profile.firstName} ${profile.lastName}`} />

      <section aria-labelledby="contact-heading" className={staffCard}>
        <h2 id="contact-heading" className={h2}>
          Your details
        </h2>
        <p className={`${headingGap} ${nums}`}>Mobile: {ukMobile(profile.mobile)}</p>
        <p className="break-words">Email: {profile.email ?? "none"}</p>
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
              className="h-18 w-18 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-18 w-18 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-ink-muted"
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
          // Rows run to the card's edges; one that stops you working is red, with a red edge.
          <ul
            role="list"
            className={`${headingGap} -mx-4 divide-y divide-line border-t border-line`}
          >
            {profile.qualifications.map((q) => {
              const blocked =
                q.status === "expired" || q.status === "suspended" || q.status === "rejected";
              const means = meaning(q);
              return (
                <li
                  key={q.type}
                  className={
                    blocked
                      ? "border-l-4 border-urgent bg-urgent-soft py-3 pr-4 pl-3 text-urgent-ink"
                      : "px-4 py-3"
                  }
                >
                  <p className="font-semibold">{qualificationTitle(q.name)}</p>
                  <p className={`mt-1 text-base ${nums}`}>
                    <StatusChip tone={QUALIFICATION_TONES[q.status]}>{statusLabel(q)}</StatusChip>
                    {dateLine(q, year) && ` · ${dateLine(q, year)}`}
                  </p>
                  {means && <p className="mt-2 text-base">{means}</p>}
                  {/* An upload can't lift a suspension; one waiting may be replaced. */}
                  {q.uploadable && q.status !== "suspended" && (
                    <p className="mt-2">
                      <Link href={`/profile/upload/${q.type}`} className={btn.link}>
                        Upload a certificate
                      </Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="-mx-4 -mb-4 border-t border-line px-4 py-3">
          <p className="font-semibold">Right to work</p>
          <p className={`mt-1 text-base ${nums}`}>{rightToWorkText(profile.rightToWork, year)}</p>
        </div>
      </section>

      {travel && (
        <section aria-labelledby="travel-heading" className={`${staffCard} ${sectionGap.staff}`}>
          <h2 id="travel-heading" className={h2}>
            {TRAVEL_TITLE}
          </h2>
          <p className={`${headingGap} ${nums}`}>{travelSummaryText(travel)}</p>
          <Link href={TRAVEL_PATH} className={`${staffBtn.secondary} mt-4`}>
            {travel.set ? "Change your travel area" : "Set your travel area"}
          </Link>
        </section>
      )}

      {strikes && <StrikesSection strikes={strikes} />}

      <section aria-labelledby="days-heading" className={`${staffCard} ${sectionGap.staff}`}>
        <h2 id="days-heading" className={h2}>
          Days you can&apos;t work
        </h2>
        <p className={`mt-1 ${muted}`}>
          We won&apos;t offer you shifts on these days. Up to {MAX_UNAVAILABLE_DAYS} days, in the
          next 6 months.
        </p>
        <AvailabilityForm
          signOff={signOff}
          days={profile.unavailable}
          min={profile.today}
          max={addDays(profile.today, UNAVAILABLE_AHEAD_DAYS)}
        />
      </section>

      <section aria-labelledby="notify-heading" className={`${staffCard} ${sectionGap.staff}`}>
        <h2 id="notify-heading" className={h2}>
          How we reach you
        </h2>
        {profile.textsOff && (
          <p
            role="note"
            className={`${headingGap} rounded-lg border border-attention bg-attention-soft p-3`}
          >
            {TEXTS_OFF}
          </p>
        )}
        <NotificationForm
          channel={profile.notifyChannel}
          offerAlerts={profile.offerAlerts}
          textsOff={profile.textsOff}
          signOff={signOff}
        />
        {push && <PushSetting publicKey={push.publicKey} firmName={push.firmName} />}
      </section>

      {/* Her requests, help, and last, Log out (docs/office-v2.md 4.1; 12H.1). */}
      <ul role="list" className="mt-8 flex flex-col gap-3 border-t border-line pt-8">
        <li>
          <Link href="/requests" className={staffBtn.secondary}>
            My requests
          </Link>
        </li>
        <li>
          <Link href="/help" className={staffBtn.secondary}>
            Help
          </Link>
        </li>
        <li>
          <LogoutButton
            kind="worker"
            after="/login?out=1"
            className={`${staffBtn.secondary} w-full`}
            icon={<Icon name="logout" />}
          />
        </li>
      </ul>
    </>
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
      <p className={`mt-1 ${muted}`}>{myStrikeRuleText(strikes.noticeHours)}</p>
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
