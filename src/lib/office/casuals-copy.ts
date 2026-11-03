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
  regulars: "Regulars",
  reliable: "Reliable",
  cancel_often: "Cancels often",
  not_worked: "Not worked lately",
  needs: "Need updating",
  uploads: "Uploads to check",
};

export const CASUAL_VIEW_EMPTY: Record<CasualView, string> = {
  all: "No casuals yet. Add them from a staff file or your rota sheet.",
  regulars: "Nobody has worked 6 of the last 8 weeks yet.",
  reliable: "Nobody is at 95% or more yet. It needs 5 shifts in 90 days to count.",
  cancel_often: "Nobody has cancelled 3 or more times under 48 hours. Good.",
  not_worked: "Everyone has worked in the last 60 days.",
  needs: "Nobody needs to update anything.",
  uploads: "Nothing to check. New photos and certificates show here.",
};

// The four counts at the top (cas-2), each opening its tab. Reliable's needs 5 shifts in 90 days
// to count (the launch review's words, in place of "95% or more, of {n} who worked").
export const COUNT_VIEWS = ["regulars", "reliable", "cancel_often", "not_worked"] as const;
export function countLine(view: (typeof COUNT_VIEWS)[number]): string {
  switch (view) {
    case "regulars":
      return "Worked 6 of the last 8 weeks";
    case "reliable":
      return "Turned up 95% or more. Needs 5 shifts in 90 days to count.";
    case "cancel_often":
      return "3 or more late cancellations (under 48 hours) in 90 days";
    case "not_worked":
      return "Nothing worked in 60 days";
  }
}

// "68 casuals · reliability over the last 90 days".
export const casualsLine = (n: number) =>
  `${n} ${n === 1 ? "casual" : "casuals"} · reliability over the last 90 days`;

// The sort (cas-3): Need updating starts with the most urgent, the rest by name.
export const SORT_WORDS = {
  default: "By name",
  least_reliable: "Least reliable first",
  last_worked: "Last worked longest ago",
  strikes: "Most strikes first",
} as const;
export const NEEDS_DEFAULT_SORT = "Most urgent first";

// "Reminded by Ann · 14:02" (today), "… · 28 Oct"; "Sent automatically · 28 Oct"; "Not reminded".
export function reminderText(
  r: { by: string | null; at: Date } | null,
  when: (d: Date) => string,
): string {
  if (!r) return "Not reminded";
  return r.by ? `Reminded by ${r.by} · ${when(r.at)}` : `Sent automatically · ${when(r.at)}`;
}
export const sortedText = (s: { by: string; at: Date }, when: (d: Date) => string) =>
  `Sorted by ${s.by} · ${when(s.at)}`;

// A missing or overdue staff photo needs updating (cas-5): the Casuals list's Need updating and a
// casual's own page count it the same way.
export const photoNeedsUpdate = (photo: Pick<StaffPhoto, "status">): boolean =>
  photo.status === "missing" || photo.status === "overdue";

// A casual's own page, "Needs updating" (the launch review's O5): after their qualifications, their
// staff photo when it needs updating, as the Casuals list counts it: "Staff photo is missing." /
// "Staff photo is overdue."; null when it doesn't.
export function photoNeedLine(photo: Pick<StaffPhoto, "status">): string | null {
  if (!photoNeedsUpdate(photo)) return null;
  return photo.status === "overdue" ? "Staff photo is overdue." : "Staff photo is missing.";
}

// What's out of date, as short chips: "SIA DS expired 28 Sep", "Staff photo missing".
export function outOfDate(
  needs: readonly NeedsItem[],
  photo: StaffPhoto,
  photoNeeds: boolean,
  year: number,
): string[] {
  const chips = needs.map((n) => qualificationLine(n.qualification, year, n.blocks !== null));
  if (photoNeeds) chips.push(`Staff photo: ${photo.status === "overdue" ? "overdue" : "missing"}`);
  return chips;
}

export {
  ADD_NOTE,
  CALL,
  MARK_SORTED,
  noteResultText,
  REMIND,
  REMIND_LINE,
  remindAllButton,
  REMINDED,
  remindResultText,
  sortedResultText,
} from "./follow-up-copy";

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
// the date that goes with it: taken on; "renew by …" when it's due soon or overdue (the launch
// review: the date taken read as a due date); sent on, while it waits for a check.
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
  const renew = photo.status === "due_soon" || photo.status === "overdue";
  const date = !photo.current
    ? null
    : renew
      ? `renew by ${shortDate(photo.current.renewBy, year)}`
      : shortDate(photo.current.uploadedOn, year);
  return {
    words,
    tone: photo.status === "up_to_date" ? null : PHOTO_TONES[photo.status],
    date,
  };
}

// "None", or the number (red on the page: a live strike counts against them).
export const strikesText = (n: number): string => (n === 0 ? "None" : String(n));

// A casual's standing as chips on their page (Phase 26.7, cas-2's four): good ones green, the
// rest amber. Someone who has never worked is new, not lapsed: "New: not worked yet".
export function standingWords(
  s: {
    regular: boolean;
    reliable: boolean;
    cancelOften: boolean;
    notWorkedLately: boolean;
  },
  lastWorked: Date | null,
): { words: string; tone: "done" | "attention" }[] {
  const out: { words: string; tone: "done" | "attention" }[] = [];
  if (s.regular) out.push({ words: "Regular", tone: "done" });
  if (s.reliable) out.push({ words: "Reliable", tone: "done" });
  if (s.cancelOften) out.push({ words: "Cancels often", tone: "attention" });
  if (s.notWorkedLately) {
    out.push({
      words: lastWorked ? "Not worked lately" : "New: not worked yet",
      tone: "attention",
    });
  }
  return out;
}

// Under a casual's reliability, how it's worked out (the launch review's words, in place of the
// formula "Worked ÷ (worked + no-shows + cancellations under 48 hours)").
export const RELIABILITY_HOW =
  "Shifts worked out of shifts booked (no-shows and cancellations under 48 hours count against them), from what the office marked.";
