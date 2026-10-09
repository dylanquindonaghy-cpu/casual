import Link from "next/link";
import { card, h2, headingGap, muted, nums, sectionGap, staffBtn } from "@/app/ui/classes";
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
import { shortDate } from "@/lib/rules/reasons";
import { addDays } from "@/lib/time/zoned";
import { WhatHappened } from "../shifts/cancel-shift-result";
import { AvailabilityForm } from "./availability-form";
import { NotificationForm } from "./notification-form";
import { PushSetting } from "./push-setting";

// Me (docs/screens.md, `/profile`): contact details and credentials as the office holds them
// (read-only), where I work (12G.1), my strikes (12C.5), days I can't work, and how we reach me. One
// card per section.

const STATUS_WORDS = {
  valid: "Valid",
  expired: "Expired",
  applied: "Applied for",
  suspended: "Suspended",
} as const;

// Each status word's colour (docs/ui-design.md "Status tones").
const TONES: Record<keyof typeof STATUS_WORDS, StatusTone> = {
  valid: "done",
  expired: "urgent",
  applied: "attention",
  suspended: "urgent",
};

// A worker who replied STOP to a text (docs/screens.md `/profile`): texts are off until START.
export const TEXTS_OFF =
  "Texts are off: you replied STOP to one of our texts. We'll send shift messages by WhatsApp. To turn texts back on, text START to our number.";

// "07700 900123" from "+447700900123"; other numbers as stored.
export const ukMobile = (e164: string) =>
  /^\+44\d{10}$/.test(e164) ? `0${e164.slice(3, 7)} ${e164.slice(7)}` : e164;

// Credential names are stored as workers say them mid-sentence ("first aid at work certificate");
// as a heading they start with a capital.
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function ProfileView({
  profile,
  signOff,
  push = null,
  eyebrow,
  strikes = null,
  travel = null,
}: {
  profile: Profile;
  signOff: string;
  push?: { publicKey: string | null; firmName: string } | null;
  eyebrow?: string; // the firm's name above the heading
  strikes?: MyStrikes | null;
  travel?: MyTravel | null;
}) {
  const year = Number(profile.today.slice(0, 4));
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={`${profile.firstName} ${profile.lastName}`} />

      <section aria-labelledby="contact-heading" className={card}>
        <h2 id="contact-heading" className={h2}>
          Your details
        </h2>
        <p className={`${headingGap} ${nums}`}>Mobile: {ukMobile(profile.mobile)}</p>
        <p className="break-words">Email: {profile.email ?? "none"}</p>
        <p className={`mt-2 ${muted}`}>To change these, ask the office.</p>
      </section>

      <section
        aria-labelledby="credentials-heading"
        className={`${card} ${sectionGap.staff} overflow-hidden`}
      >
        <h2 id="credentials-heading" className={h2}>
          Licences and cards
        </h2>
        {profile.credentials.length === 0 ? (
          <p className={headingGap}>None on file. Send yours to the office to be checked.</p>
        ) : (
          // Rows run to the card's edges; one that stops you working is red, with a red edge.
          <ul
            role="list"
            className={`${headingGap} -mx-4 -mb-4 divide-y divide-line border-t border-line`}
          >
            {profile.credentials.map((c, i) => {
              const blocked = c.expired || c.status === "suspended";
              return (
                <li
                  key={`${c.type}:${i}`}
                  className={
                    blocked
                      ? "border-l-4 border-urgent bg-urgent-soft py-3 pr-4 pl-3 text-urgent-ink"
                      : "px-4 py-3"
                  }
                >
                  <p className="font-semibold">{title(c.name)}</p>
                  <p className={`mt-1 text-base ${nums}`}>
                    <StatusChip tone={c.expired ? "urgent" : TONES[c.status]}>
                      {c.expired ? "Expired" : STATUS_WORDS[c.status]}
                    </StatusChip>
                    {c.expiresOn
                      ? ` · ${c.expired ? "expired" : "expires"} ${shortDate(c.expiresOn, year)}`
                      : c.status === "valid"
                        ? " · no expiry date"
                        : ""}
                  </p>
                  {c.expired ? (
                    <p className="mt-2 text-base">
                      You can&apos;t take shifts that need it. Renew it and send the new details to
                      the office.
                    </p>
                  ) : c.status === "suspended" ? (
                    <p className="mt-2 text-base">
                      You can&apos;t take shifts that need it. Contact the office.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {travel && (
        <section aria-labelledby="travel-heading" className={`${card} ${sectionGap.staff}`}>
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

      <section aria-labelledby="days-heading" className={`${card} ${sectionGap.staff}`}>
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

      <section aria-labelledby="notify-heading" className={`${card} ${sectionGap.staff}`}>
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

      <Link href="/" className={`${staffBtn.secondary} mt-8`}>
        Back to my shifts
      </Link>
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
      className={`${card} ${sectionGap.staff} overflow-hidden`}
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
