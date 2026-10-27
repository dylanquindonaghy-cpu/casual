import { requirementChip } from "../credentials/requirements";
import type { NeedsItem, Qualification, QualificationStatus } from "../credentials/status";
import { OFFICE_PHOTO_WORDS, PHOTO_TONES } from "../portal/upload-copy";
import { shortDate } from "../rules/reasons";
import type { StaffPhoto } from "../uploads/photo";
import type { CasualView } from "./casuals";

// Casuals in plain words (docs/office-v2.md 3.7; docs/screens.md `/office/casuals`; Phase 24, 24.4:
// round 7 of the canvas). Pure: the page and the tests call these with the loader's rows.

export const CASUAL_VIEW_WORDS: Record<CasualView, string> = {
  all: "All",
  needs: "Need updating",
  uploads: "Uploads to check",
};

export const CASUAL_VIEW_EMPTY: Record<CasualView, string> = {
  all: "No casuals yet. Add them from a staff file or your rota sheet.",
  needs: "Nobody needs to update anything.",
  uploads: "Nothing to check. New photos and certificates show here.",
};

// A qualification's state, mid-line, with its date where it has one ("valid until 12 May 2027",
// "expires 14 Nov": the year only when it isn't this year's).
const STATE_WORDS: Record<QualificationStatus, string> = {
  valid: "valid",
  expiring_soon: "expires",
  expired: "expired",
  missing: "missing",
  applied: "applied for",
  suspended: "suspended",
  being_checked: "being checked",
  rejected: "not accepted",
};
const DATED: QualificationStatus[] = ["valid", "expiring_soon", "expired"];

// "SIA DS: valid until 12 May 2027", "SIA SG: expires 14 Nov", "First aid: expires 30 Oct (booked
// shift)" (it stops a shift they're booked on), "CSAS: being checked". The short name the session
// chips use (requirementChip), else the qualification's own.
export function qualificationLine(
  q: Pick<Qualification, "type" | "name" | "status" | "expiresOn">,
  year: number,
  blocksBooking = false,
): string {
  const short = requirementChip({ code: q.type, name: q.name });
  const date =
    q.expiresOn && DATED.includes(q.status)
      ? ` ${q.status === "valid" ? "until " : ""}${shortDate(q.expiresOn, year)}`
      : "";
  return `${short}: ${STATE_WORDS[q.status]}${date}${blocksBooking ? " (booked shift)" : ""}`;
}

// Whether something needing updating stops a shift they're booked on (Need updating's first rule).
export const blocksBooking = (needs: readonly NeedsItem[], type: string): boolean =>
  needs.some((n) => n.qualification.type === type && n.blocks !== null);

// The Needs updating column: the worst first, in the qualifications' words ("SIA SG: expires 14
// Nov"), "and 2 more" after it; "Nothing".
export function needsLine(needs: readonly NeedsItem[], year: number): string {
  const [first, ...rest] = needs;
  if (!first) return "Nothing";
  const head = qualificationLine(first.qualification, year, first.blocks !== null);
  return rest.length === 0 ? head : `${head}, and ${rest.length} more`;
}

// The staff photo column: its state ("Up to date", or a chip when it needs someone), and under it
// the date that goes with it (taken on; sent on, while it waits for a check).
export function photoCell(
  photo: StaffPhoto,
  year: number,
): {
  words: string;
  tone: (typeof PHOTO_TONES)[keyof typeof PHOTO_TONES] | null;
  date: string | null;
} {
  const words = OFFICE_PHOTO_WORDS[photo.status];
  if (photo.status === "waiting" && photo.waiting) {
    return {
      words,
      tone: PHOTO_TONES.waiting,
      date: `Sent ${shortDate(photo.waiting.uploadedOn, year)}`,
    };
  }
  const taken = photo.current ? shortDate(photo.current.uploadedOn, year) : null;
  return {
    words,
    tone: photo.status === "up_to_date" ? null : PHOTO_TONES[photo.status],
    date: taken,
  };
}

// "None", or the number (red on the page: a live strike counts against them).
export const strikesText = (n: number): string => (n === 0 ? "None" : String(n));
