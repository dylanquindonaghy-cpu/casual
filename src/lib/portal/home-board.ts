import { daysUntil } from "../credentials/expiry";
import {
  STATUS_ORDER,
  type Qualification,
  type QualificationStatus,
  type RightToWork,
} from "../credentials/status";
import { RELIABILITY_MIN, type Reliability } from "../rules/reliability";
import type { StaffPhoto } from "../uploads/photo";
import { payEstimatePence, sessionHours } from "./format";
import {
  aboutPayText,
  COUNT_WORDS,
  daysLeftText,
  expiresInText,
  NEW_FIGURE,
  NO_EXPIRY,
  OTHER_QUALS_PATH,
  PHOTO_CHECKING,
  PHOTO_NEW,
  PHOTO_NONE,
  PHOTO_PATH,
  PHOTO_TITLE,
  QUALS_PATH,
  RELIABILITY_LABEL,
  renewByText,
  RTW_NONE_LINE,
  RTW_RAN_OUT_LINE,
  RTW_TITLE,
  RTW_WORDS,
  scoreAfterText,
  SEE_THE_SHIFT,
  startsInText,
  strikesLabel,
  updateWhenText,
  UPDATES_MAX,
  validForText,
  workedLabel,
} from "./home-copy";
import type { MyRecordRow } from "./my-record";
import { hoursText, pounds } from "./pay-format";
import {
  dateLine,
  IN_HAND,
  needsUpload,
  qualificationTitle,
  rightToWorkText,
  STATUS_TONES,
  STATUS_WORDS,
} from "./qualification-copy";
import { NO_LONGER_LISTED, recordShiftName, recordShiftStart, recordTitle } from "./record-copy";

// Home as the casual's dashboard (Phase 30.1; docs/screens.md "### 30.1"): every figure its new
// parts show, worked out by code from her own rows (golden rule 1). Pure and browser-safe: the page
// loads the rows (src/lib/portal/my-home.ts and the loaders it already used) and passes them in.

export type Tone = "urgent" | "attention" | "done" | "quiet";

// --- The counts under "Hi Zoe" ------------------------------------------------------------------

export interface CountPill {
  key: keyof typeof COUNT_WORDS;
  label: string;
  count: number;
  href: string;
  tone: "plain" | "urgent" | "todo";
  // Its number goes stale without signal: shown online only (the kept copy leaves it out).
  onlineOnly: boolean;
}

// Booked (her upcoming bookings, as /shifts counts them), Open to you (the shifts she can take, as
// /shifts/open counts them), Urgent (as /urgent counts them; only when there are any), To do (what
// "Do this" stands for; only when there's something), Messages (the office's replies she hasn't
// read, as the Messages tab counts them). Booked is hers alone, so it stays in the kept copy.
export function countPills(c: {
  booked: number;
  open: number;
  urgent: number;
  todo: number;
  messages: number;
}): CountPill[] {
  const pills: CountPill[] = [
    pill("booked", c.booked, "/shifts", "plain", false),
    pill("open", c.open, "/shifts/open", "plain", true),
  ];
  if (c.urgent > 0) pills.push(pill("urgent", c.urgent, "/urgent", "urgent", true));
  if (c.todo > 0) pills.push(pill("todo", c.todo, "#do-this-heading", "todo", true));
  pills.push(pill("messages", c.messages, "/messages", "plain", true));
  return pills;
}
const pill = (
  key: CountPill["key"],
  count: number,
  href: string,
  tone: CountPill["tone"],
  onlineOnly: boolean,
): CountPill => ({ key, label: COUNT_WORDS[key], count, href, tone, onlineOnly });

// --- The next shift's line -----------------------------------------------------------------------

// How long the bar under the next shift takes to fill: it fills over the last 7 days before the
// start (empty further off, full at the start).
export const COUNTDOWN_DAYS = 7;

export function countdownFill(startsAt: Date, now: Date): number {
  const left = startsAt.getTime() - now.getTime();
  return clamp(1 - left / (COUNTDOWN_DAYS * 86_400_000));
}

// "Starts in 70 hours" (online only: it goes stale), then "8 hours · about £108.00 before tax"
// (the pay left out when the session has no rate). The estimate is the booked shift page's own sum
// (format.ts payEstimatePence).
export function nextShiftLine(
  shift: { startsAt: Date; endsAt: Date; payRatePence?: number | null },
  now: Date,
): { startsIn: string | null; facts: string; fill: number } {
  const hours = hoursText(sessionHours(shift.startsAt, shift.endsAt));
  const pay =
    shift.payRatePence != null
      ? aboutPayText(pounds(payEstimatePence(shift.payRatePence, shift.startsAt, shift.endsAt)))
      : null;
  return {
    startsIn: startsInText(shift.startsAt, now),
    facts: pay ? `${hours} · ${pay}` : hours,
    fill: countdownFill(shift.startsAt, now),
  };
}

// --- "Your qualifications" -----------------------------------------------------------------------

// The bar under one with an expiry date: how much time is left, full at QUAL_BAR_FULL_DAYS (2
// years) or more, empty on its last day. One rule for every row (her qualifications and her staff
// photo alike): an issue date isn't on her records, so the bar can't be a share of its whole life.
export const QUAL_BAR_FULL_DAYS = 730;
export const barFill = (daysLeft: number): number => clamp(daysLeft / QUAL_BAR_FULL_DAYS);

export interface QualRow {
  key: string;
  kind: "qualification" | "photo" | "right_to_work";
  title: string;
  pill: { words: string; tone: Tone };
  bar: number | null; // 0 to 1; null: no bar (no expiry, or not in date)
  line: string | null; // the line under it
  action: string | null; // words styled as a link at the end of the line ("Take a new photo")
  href: string;
}

type MyQual = Qualification & { inHand?: boolean };

// Where a status sits in "worst first" (src/lib/credentials/status.ts STATUS_ORDER). One the office
// has in hand (28.11) isn't hers to do, so it goes after the ones that are, before the valid ones;
// right to work not recorded sits there too (a status only, never a stop).
const rankOf = (status: QualificationStatus) => STATUS_ORDER.indexOf(status);
const AFTER_TO_DO = rankOf("applied") + 0.5;

interface Ranked {
  row: QualRow;
  rank: number;
  expiresOn: string | null;
}

function qualRow(q: MyQual, today: string, year: number, other: boolean): Ranked {
  const days = q.expiresOn ? daysUntil(today, q.expiresOn) : null;
  const words =
    q.status === "valid"
      ? days === null
        ? NO_EXPIRY
        : validForText(days)
      : q.status === "expiring_soon" && days !== null
        ? expiresInText(days)
        : STATUS_WORDS[q.status];
  const inDate = q.status === "valid" || q.status === "expiring_soon";
  const upload =
    !other && !q.inHand && q.status !== "valid" && needsUpload(q)
      ? `/profile/upload/${q.type}`
      : null;
  return {
    row: {
      key: `q-${q.type}`,
      kind: "qualification",
      title: qualificationTitle(q.name),
      pill: { words, tone: STATUS_TONES[q.status] },
      bar: inDate && days !== null ? barFill(days) : null,
      line: q.inHand ? IN_HAND : q.status === "valid" && days === null ? null : dateLine(q, year),
      action: null,
      href: upload ?? (other ? OTHER_QUALS_PATH : QUALS_PATH),
    },
    rank: q.inHand ? AFTER_TO_DO : rankOf(q.status),
    expiresOn: q.expiresOn,
  };
}

// The staff photo as a row: its status in the qualifications' order (overdue as expired, missing
// as missing, waiting as being checked, due soon as expiring soon, up to date as valid).
const PHOTO_AS: Record<StaffPhoto["status"], QualificationStatus> = {
  overdue: "expired",
  missing: "missing",
  waiting: "being_checked",
  due_soon: "expiring_soon",
  up_to_date: "valid",
};
const PHOTO_PILL: Record<StaffPhoto["status"], Tone> = {
  overdue: "urgent",
  missing: "attention",
  waiting: "quiet",
  due_soon: "attention",
  up_to_date: "done",
};
function photoRow(photo: StaffPhoto, today: string): Ranked {
  const renewBy = photo.current?.renewBy ?? null;
  const days = renewBy ? daysUntil(today, renewBy) : null;
  const words =
    photo.status === "due_soon" && days !== null
      ? daysLeftText(days)
      : photo.status === "up_to_date" && days !== null
        ? validForText(days)
        : photo.status === "overdue"
          ? "Overdue"
          : photo.status === "missing"
            ? STATUS_WORDS.missing
            : photo.status === "waiting"
              ? STATUS_WORDS.being_checked
              : "Up to date";
  const line =
    photo.status === "waiting" ? PHOTO_CHECKING : renewBy ? renewByText(renewBy) : PHOTO_NONE;
  const toDo =
    photo.status === "due_soon" || photo.status === "overdue" || photo.status === "missing";
  return {
    row: {
      key: "photo",
      kind: "photo",
      title: PHOTO_TITLE,
      pill: { words, tone: PHOTO_PILL[photo.status] },
      bar:
        (photo.status === "up_to_date" || photo.status === "due_soon") && days !== null
          ? barFill(days)
          : null,
      line,
      action: toDo ? PHOTO_NEW : null,
      href: PHOTO_PATH,
    },
    rank: rankOf(PHOTO_AS[photo.status]),
    expiresOn: renewBy,
  };
}

// Right to work: a status only (Rules 15), never "you can't be booked".
function rightToWorkRow(r: RightToWork, year: number): Ranked {
  const words = r.checked ? RTW_WORDS.checked : r.expired ? RTW_WORDS.ranOut : RTW_WORDS.none;
  return {
    row: {
      key: "right-to-work",
      kind: "right_to_work",
      title: RTW_TITLE,
      pill: { words, tone: r.checked ? "done" : r.expired ? "attention" : "quiet" },
      bar: null,
      line: r.checked ? rightToWorkText(r, year) : r.expired ? RTW_RAN_OUT_LINE : RTW_NONE_LINE,
      action: null,
      href: QUALS_PATH,
    },
    rank: r.checked ? rankOf("valid") : AFTER_TO_DO,
    expiresOn: null,
  };
}

// Every row, worst first, then the soonest expiry (none last), then by name: her qualifications
// (what her roles need, then what a booking or offer of hers needs on top), her staff photo and her
// right to work. A lapsed one never reads valid: the statuses are the credential rules' own
// (src/lib/credentials/status.ts), as Profile shows them.
export function qualificationRows(o: {
  qualifications: readonly MyQual[];
  others?: readonly Qualification[];
  photo: StaffPhoto;
  rightToWork: RightToWork;
  today: string; // yyyy-mm-dd, the firm's calendar
}): QualRow[] {
  const year = Number(o.today.slice(0, 4));
  const ranked: Ranked[] = [
    ...o.qualifications.map((q) => qualRow(q, o.today, year, false)),
    ...(o.others ?? []).map((q) => qualRow(q, o.today, year, true)),
    photoRow(o.photo, o.today),
    rightToWorkRow(o.rightToWork, year),
  ];
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") ||
        a.row.title.localeCompare(b.row.title),
    )
    .map((r) => r.row);
}

// --- "Updates" -----------------------------------------------------------------------------------

export interface UpdateRow {
  key: string;
  title: string; // "Booked by you"
  sub: string; // "Steward at Riverside Arena · Mon 9 Nov, 14:00"
  when: string; // "Wed 15:02"
  href: string | null; // the shift's page, while she can open it
  link: string;
}

// Her latest UPDATES_MAX entries from her shift record (already newest first), in its words.
export function updateRows(rows: readonly MyRecordRow[], now: Date, timeZone: string): UpdateRow[] {
  return rows.slice(0, UPDATES_MAX).map((r, i) => ({
    key: `${r.at.getTime()}-${i}`,
    title: recordTitle(r),
    sub: r.shift
      ? `${recordShiftName(r.shift)} · ${recordShiftStart(r.shift, timeZone)}`
      : NO_LONGER_LISTED,
    when: updateWhenText(r.at, now, timeZone),
    href: r.shift?.canOpen ? `/shifts/${r.shift.id}` : null,
    link: SEE_THE_SHIFT,
  }));
}

// --- "Your record" -------------------------------------------------------------------------------

export interface RecordFigure {
  key: "worked" | "reliability" | "strikes";
  figure: string;
  label: string;
}

// Shifts worked and reliability over the last 90 days (Profile's figures: the office's own,
// src/lib/rules/reliability.ts), and the strikes that still count (Profile's, my-strikes.ts), left
// out where Profile leaves its Strikes section out (strikes off and none given before).
export function recordFigures(
  reliability: Reliability,
  strikes: { counting: number; liveDays: number; shown: boolean } | null,
): RecordFigure[] {
  const figures: RecordFigure[] = [
    {
      key: "worked",
      figure: String(reliability.counts.worked),
      label: workedLabel(reliability.counts.worked),
    },
    reliability.kind === "figure"
      ? { key: "reliability", figure: `${reliability.percent}%`, label: RELIABILITY_LABEL }
      : { key: "reliability", figure: NEW_FIGURE, label: scoreAfterText(RELIABILITY_MIN) },
  ];
  if (strikes?.shown) {
    figures.push({
      key: "strikes",
      figure: String(strikes.counting),
      label: strikesLabel(strikes.counting, strikes.liveDays),
    });
  }
  return figures;
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
