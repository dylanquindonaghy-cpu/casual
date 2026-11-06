import { dayLabel } from "../rules/reasons";
import { addDays, localDateOf, wallTimeOf } from "../time/zoned";
import { noticeText } from "./cancel-reasons";
import { roleLabel, shiftWhen } from "./format";
import type { MyRecordRow, RecordStrike } from "./my-record";

// "Your shift record" in words (docs/screens.md "The casual app, Phase 28", 28.4). Pure: the page
// passes the firm's time zone. Every row is someone she knows by "you" or "the office": no names,
// no pay, and nothing about money owed or short notice (no entitlement wording until the 2027 rules
// are final: docs/compliance.md "Employment Rights Act").

export const RECORD_PATH = "/shifts/record";
export const RECORD_TITLE = "Your shift record";
export const RECORD_INTRO =
  "Every offer, booking, change and cancellation for you in the last 90 days, with the notice you had.";
export const RECORD_EMPTY = "Nothing in the last 90 days.";
// The foot: its last words link to Messages, so there's a way to ask.
export const RECORD_FOOT_LEAD = "Older records:";
export const RECORD_FOOT_LINK = "ask the office for a copy";
export const RECORD_FOOT = `${RECORD_FOOT_LEAD} ${RECORD_FOOT_LINK}.`;
export const NOTICE_NOT_RECORDED = "Notice not recorded";
export const NO_LONGER_LISTED = "A shift no longer listed";

export const recordMoreText = (shown: number) => `Showing the newest ${shown}.`;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// What happened, as the row's title.
export function recordTitle(row: Pick<MyRecordRow, "kind" | "by">): string {
  switch (row.kind) {
    case "offered":
      return "Offered to you";
    case "booked":
      return row.by === "you" ? "Booked by you" : "Booked by the office";
    case "moved":
      return "Moved by the office";
    case "shortened":
      return "Shortened by the office";
    case "cancelled":
      return row.by === "you" ? "You cancelled" : "Cancelled by the office";
  }
}

// "Steward at Riverside Arena".
export function recordShiftName(shift: NonNullable<MyRecordRow["shift"]>): string {
  return `${roleLabel(shift.role)}${shift.site ? ` at ${shift.site}` : ""}`;
}

// "Sat 7 Nov, 08:00": the shift's start.
export function recordShiftStart(shift: NonNullable<MyRecordRow["shift"]>, tz: string): string {
  return `${dayLabel(localDateOf(shift.startsAt, tz))}, ${hhmm(shift.startsAt, tz)}`;
}

// "From Sat 7 Nov, 06:00 to 14:00" / "To Sat 7 Nov, 08:00 to 16:00".
export function recordMoveLines(moved: NonNullable<MyRecordRow["moved"]>, tz: string): string[] {
  return [
    `From ${shiftWhen(moved.fromStart, moved.fromEnd, tz)}`,
    `To ${shiftWhen(moved.toStart, moved.toEnd, tz)}`,
  ];
}
export const SITE_CHANGED_TOO = "The site changed too.";

// The notice as it was logged: "You had 21 hours' notice.", "You gave 20 hours' notice." on her own
// cancellation, "After the shift started.", or "Notice not recorded".
export function recordNoticeText(row: Pick<MyRecordRow, "kind" | "by" | "noticeHours">): string {
  const h = row.noticeHours;
  if (h === null || !Number.isFinite(h)) return NOTICE_NOT_RECORDED;
  if (h < 0) return "After the shift started.";
  return row.kind === "cancelled" && row.by === "you"
    ? `You gave ${noticeText(h)}.`
    : `You had ${noticeText(h)}.`;
}

// Who asked for the office's cancellation, where that was recorded.
export function recordAskedText(askedBy: MyRecordRow["askedBy"]): string | null {
  if (askedBy === "client") return "The client asked.";
  if (askedBy === "casual") return "You asked.";
  return null;
}

// "Reference 0695DD8C" (the reference itself in the mono face, beside these words).
export const RECORD_REF_LEAD = "Reference";
export const recordOwnReasonText = (reason: string) => `Your reason: ${reason}`;

// The strike chip's words (null: no chip).
export const STRIKE_WORDS: Record<RecordStrike, string> = {
  strike: "Strike",
  withdrawn: "Strike (withdrawn by the office)",
  none: "No strike",
};

// A day's heading: "Today", "Yesterday", or "Mon 2 Nov".
export function recordDayHeading(day: string, now: Date, tz: string): string {
  const today = localDateOf(now, tz);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayLabel(day);
}

// The rows by the firm's local day, newest first (the rows come newest first).
export function recordDays(
  rows: readonly MyRecordRow[],
  tz: string,
): { day: string; rows: MyRecordRow[] }[] {
  const days: { day: string; rows: MyRecordRow[] }[] = [];
  for (const row of rows) {
    const day = localDateOf(row.at, tz);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}

// "09:14": when it happened, on its day.
export const recordTime = (at: Date, tz: string) => hhmm(at, tz);
