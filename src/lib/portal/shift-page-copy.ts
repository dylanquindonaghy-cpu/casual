import type { QualificationState } from "../credentials/status";
import { shortDate } from "../rules/reasons";
import {
  DISTANCE_NOT_KNOWN,
  straightMiles,
  TIME_NOT_KNOWN,
  type TravelFacts,
} from "../travel/line-copy";
import { wallTimeOf } from "../time/zoned";

// A shift's page in plain words (docs/office-v2.md 4.4; docs/screens.md `/shifts/[id]`; 12H.2).
// Pure, so the tests read exactly what the casual reads.

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

// Under "Take shift": the firm's own notice (strikes.notice_hours, 48 by default).
export const strikeNoteText = (noticeHours: number) =>
  `Cancelling less than ${noticeHours} hours before the start gives you a strike.`;

export type RequirementTone = "done" | "attention" | "urgent";

export interface RequirementWords {
  words: string; // "You have it, valid until 3 Mar 2027", "Missing:"
  upload: boolean; // followed by an "upload it" link to her upload page
  tone: RequirementTone;
}

// Her status for one thing the shift needs ("What it needs"), read as Profile reads it
// (qualificationStatus()), against the shift's last day: one valid today that runs out before then
// "Expires before this shift". `uploadable`: she may send it herself (not one the office records).
// `year`: the shift's year (a date in another year shows its year).
export function requirementWords(
  q: Pick<QualificationState, "status" | "expiresOn">,
  o: { lastDay: string; year: number; uploadable: boolean },
): RequirementWords {
  const date = (d: string) => shortDate(d, o.year);
  const fix = (words: string, ask: string): RequirementWords =>
    o.uploadable
      ? { words: `${words}:`, upload: true, tone: "urgent" }
      : { words: `${words}: ${ask}`, upload: false, tone: "urgent" };
  switch (q.status) {
    case "valid":
    case "expiring_soon":
      if (q.expiresOn === null) return { words: "You have it", upload: false, tone: "done" };
      if (q.expiresOn < o.lastDay) return fix("Expires before this shift", "ask the office.");
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
      return fix("Missing", "ask the office.");
    case "expired":
      return fix(q.expiresOn ? `Expired on ${date(q.expiresOn)}` : "Expired", "ask the office.");
    case "rejected":
      return fix("Not accepted", "ask the office.");
    case "suspended":
      return { words: "Suspended: contact the office.", upload: false, tone: "urgent" };
  }
}
