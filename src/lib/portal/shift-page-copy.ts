import type { QualificationState } from "../credentials/status";
import { briefingWords, type BriefingField } from "../notices/briefing-fields";
import { noticeHours as hoursBefore } from "../roster/notice";
import type { RuleCode } from "../rules/eligibility";
import { dayLabel, shortDate } from "../rules/reasons";
import { startsInText, STRIKE_IS_A_RECORD } from "../strikes/words";
import {
  DISTANCE_NOT_KNOWN,
  straightMiles,
  TIME_NOT_KNOWN,
  travelLineText,
  type TravelFacts,
} from "../travel/line-copy";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { messageOfficeHref } from "./message-office";

// A shift's page in plain words (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]`; 12H.2;
// Phase 28.5: "The casual app, Phase 28" 28.5). Pure and browser-safe, so the tests read exactly
// what the casual reads, and every link to the office is built from 28.2's one contract
// (src/lib/portal/message-office.ts).

const METRES_PER_MILE = 1609.344;
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

// "Getting there", one line each: "8.4 miles away", "About 21 min by car", "About 38 min by public
// transport" (or "No public transport by 09:30"; "Over 90 min by car"). Not worked out yet:
// "About 7 miles away (straight line)" and "Travel time not known yet"; no travel area or no
// location: "Distance not known yet".
export function gettingThereLines(f: TravelFacts, tz: string): string[] {
  if (f.kind === "unknown") return [DISTANCE_NOT_KNOWN];
  if (f.kind === "straight") return [straightAway(f.straightMetres), TIME_NOT_KNOWN];
  return [
    f.car?.metres != null
      ? `${(f.car.metres / METRES_PER_MILE).toFixed(1)} miles away`
      : straightAway(f.straightMetres),
    f.car ? `About ${f.car.minutes} min by car` : "Over 90 min by car",
    f.publicTransport
      ? `About ${f.publicTransport.minutes} min by public transport`
      : `No public transport by ${hhmm(f.arriveBy, tz)}`,
  ];
}

// "About 7 miles away (straight line)", from the travel line's own rounding.
const straightAway = (metres: number) =>
  straightMiles(metres).replace(/^about (.*) \(straight line\)$/, "About $1 away (straight line)");

// "1 of 4 left".
export const placesText = (left: number, headcount: number) => `${left} of ${headcount} left`;

// Under "Take shift": the firm's own notice (strikes.notice_hours, 48 by default), and what a
// strike is.
export const strikeNoteText = (noticeHours: number) =>
  `Cancelling less than ${noticeHours} hours before the start gives you a strike. ${STRIKE_IS_A_RECORD}`;

// Under "Take shift" (Phase 28.5; the review's note 14): a shift that already starts within the
// firm's notice says so with its own hours ("This shift starts in 37 hours. If you cancel it,
// you'll get a strike."), counted as the cancel sheet counts them (startsInText: rounded down,
// "less than an hour", days from 48 hours); further off, the firm's rule as before. Her own take,
// cancelled inside the notice, is a strike (src/lib/strikes/decide.ts). The page shows neither when
// the firm has strikes off (`strikesOn`).
export function strikeNote(o: { startsAt: Date; now: Date; noticeHours: number }): string {
  const hours = hoursBefore(o.startsAt, o.now);
  if (hours < o.noticeHours) {
    return `This shift starts in ${startsInText(Math.max(0, hours))}. If you cancel it, you'll get a strike.`;
  }
  return strikeNoteText(o.noticeHours);
}

// "Getting there" until the travel time is worked out (Phase 28.5; the review's note 12): one
// sentence, the travel line Home and Open shifts show (src/lib/travel/line-copy.ts, whose words are
// 28.8's: one source), in place of figure tiles that read as values. Null once the times are known:
// then the figures.
export function travelSentence(f: TravelFacts, tz: string): string | null {
  return f.kind === "estimated" ? null : travelLineText(f, tz);
}

// Every link to the office on the page is this one, with words that say where it goes.
export const MESSAGE_OFFICE = "Message the office";

// The Pay card of a session with no rate set: what it says, then the way to ask (the review's
// major 2: "Ask the office" was plain text). Before the session ends, a message to the office
// about it (/messages?shift={id}&about=pay); on her booking once it has ended, payroll's pay query
// (/pay/query?shift={id}: golden rule 9, a worked shift's pay question never goes to a resourcer),
// which messageOfficeHref() chooses by the session's end.
export const NO_PAY_YET = "Not given yet.";
export function payAsk(
  shift: { id: string; endsAt: Date },
  now: Date,
): { label: string; href: string } {
  const ended = shift.endsAt.getTime() <= now.getTime();
  return {
    label: ended ? "Raise a pay query" : "Ask the office about the pay",
    href: messageOfficeHref(shift, "pay", now),
  };
}

// The links on her own booking (Phase 28.5; the review's major 1): "Running late?" from
// LATE_WINDOW_HOURS before the start until the end, "Message the office" once it has started (in
// place of the dead end "Contact the office"), and "Add to my calendar" until it ends. Only a live
// booking (`confirmed`): one the office has marked worked or not attended has none. Null where a
// link doesn't show.
export const LATE_WINDOW_HOURS = 3;
export const RUNNING_LATE = "Running late?";
export const ADD_TO_CALENDAR = "Add to my calendar";
export const CALENDAR_AGAIN = "The times changed. Add it to your calendar again.";

export const calendarHref = (shiftId: string) => `/shifts/${shiftId}/calendar`;

export interface BookedLinks {
  late: string | null;
  started: string | null;
  calendar: string | null;
}

export function bookedLinks(
  shift: { id: string; startsAt: Date; endsAt: Date; status: string },
  now: Date,
): BookedLinks {
  const t = now.getTime();
  const live = shift.status === "confirmed" && t < shift.endsAt.getTime();
  const soon = shift.startsAt.getTime() - LATE_WINDOW_HOURS * 3_600_000 <= t;
  const started = shift.startsAt.getTime() <= t;
  return {
    late: live && soon ? messageOfficeHref(shift, "late", now) : null,
    started: live && started ? messageOfficeHref(shift, "started", now) : null,
    calendar: live ? calendarHref(shift.id) : null,
  };
}

// The rules' reasons that send her to the office ("Your SIA door supervisor licence is suspended.
// Contact the office.", "This site isn't available to you. Contact the office."; src/lib/rules/
// reasons.ts). The office reads the same words, so they stay; the page puts "Message the office"
// with them (Phase 28.5).
export const OFFICE_REASON_CODES: readonly RuleCode[] = [
  "not_active",
  "no_rule",
  "credential_suspended",
  "blocked_site",
];
export const reasonsNeedOffice = (codes: readonly RuleCode[] | undefined): boolean =>
  (codes ?? []).some((code) => OFFICE_REASON_CODES.includes(code));

// "Changed since you booked: instructions and meeting point (Tue 3 Nov, 14:05)" (Phase 28.5): the
// briefing's parts in the casual's words (28.2's list, src/lib/notices/briefing-fields.ts: never a
// value, never places or other people) and when the last of them changed, in the firm's time
// zone. Null when nothing in the briefing changed.
export function changedSinceText(
  c: { fields: readonly BriefingField[]; at: Date },
  tz: string,
): string | null {
  const words = briefingWords(c.fields);
  if (!words) return null;
  return `Changed since you booked: ${words} (${dayLabel(localDateOf(c.at, tz))}, ${hhmm(c.at, tz)})`;
}

export type RequirementTone = "done" | "attention" | "urgent";

export interface RequirementWords {
  words: string; // "You have it, valid until 3 Mar 2027", "Missing:"
  upload: boolean; // followed by an "upload it" link to her upload page
  tone: RequirementTone;
  // Followed by a "Message the office" link (Phase 28.5): only the office can sort it (one she
  // can't send herself, or a suspended one).
  message?: true;
}

// Her status for one thing the shift needs ("What it needs"), read as Profile reads it
// (qualificationStatus()), against the shift's last day: one valid today that runs out before then
// "Expires before this shift" (unless her renewal is waiting: `renewing`). `uploadable`: she may send
// it herself (one of her roles needs it, and the office doesn't record it).
// `year`: the shift's year (a date in another year shows its year).
export function requirementWords(
  q: Pick<QualificationState, "status" | "expiresOn"> & { renewing?: boolean },
  o: { lastDay: string; year: number; uploadable: boolean },
): RequirementWords {
  const date = (d: string) => shortDate(d, o.year);
  // She sends it herself ("Missing:" + "upload it"), or the office sorts it ("Missing." + "Message
  // the office"; Phase 28.5: it was "Missing: ask the office.", with no way to ask).
  const fix = (words: string): RequirementWords =>
    o.uploadable
      ? { words: `${words}:`, upload: true, tone: "urgent" }
      : { words: `${words}.`, upload: false, tone: "urgent", message: true };
  switch (q.status) {
    case "valid":
    case "expiring_soon":
      if (q.expiresOn === null) return { words: "You have it", upload: false, tone: "done" };
      if (q.expiresOn < o.lastDay) {
        // Her new one is already with the office: nothing more for her to send.
        if (q.renewing) {
          return {
            words: "Expires before this shift: your new one is being checked.",
            upload: false,
            tone: "attention",
          };
        }
        return fix("Expires before this shift");
      }
      return {
        words: `You have it, valid until ${date(q.expiresOn)}`,
        upload: false,
        tone: "done",
      };
    case "being_checked":
      return { words: "Being checked", upload: false, tone: "attention" };
    case "applied":
      return { words: "Applied for, not issued yet", upload: false, tone: "attention" };
    case "missing":
      return fix("Missing");
    case "expired":
      return fix(q.expiresOn ? `Expired on ${date(q.expiresOn)}` : "Expired");
    case "rejected":
      return fix("Not accepted");
    case "suspended":
      return { words: "Suspended.", upload: false, tone: "urgent", message: true };
  }
}
