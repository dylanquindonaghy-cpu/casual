import type { ImportResult } from "../imports/import";
import { PROBLEM_TEXT } from "../imports/messages";
import type { MarkAttendanceResult, MarkRestWorkedResult } from "../roster/attendance";
import type { BookingResult } from "../roster/book";
import type { CancelBookingResult, CancelShiftResult } from "../roster/cancel";
import type { MoveShiftResult } from "../roster/firm-change";
import { noticeText } from "../portal/cancel-reasons";
import type { CreateShiftsResult, EditShiftResult, ShiftProblem } from "./shift-editor";
import type { ShiftImportResult } from "./shift-import";
import { AGREEMENT_NEEDED_TEXT, FILE_ERROR_TEXT } from "../imports/messages";

// The office's shift screens in plain words (docs/screens.md `/office/shifts`).

export const SHIFT_STATUS_WORDS = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  cancelled: "Cancelled",
} as const;

// A booked person who can't work it as things stand (Phase 10): also on Today's "Bookings to
// check".
export const PLACE_FLAG_WORDS = {
  inactive: "Not active",
  blocked: "Blocked",
  site_blocked: "Can't work at this site",
} as const;

export const PLACE_STATUS_WORDS: Record<string, string> = {
  confirmed: "Booked",
  completed: "Worked",
  no_show: "Didn't attend",
  offered: "Offered",
  cancelled_worker: "Cancelled by them",
  cancelled_firm: "Cancelled by the office",
};

export const SHIFT_PROBLEM_TEXT: Record<ShiftProblem, string> = {
  bad_date: "Choose a date.",
  bad_time:
    "Enter the start and finish as times, like 08:00. They can't be the same, 24 hours or more apart, or in the hour the clocks skip in March.",
  bad_role: "Enter a role, like steward (letters, numbers and spaces only).",
  bad_headcount: "Places must be a whole number from 1 to 1000.",
  bad_site: "Choose a site from the list.",
  in_past: "That start time has already passed.",
  text_too_long: "The instructions are too long (2,000 characters at most).",
  no_lines: "Fill in at least one shift.",
  bad_form: "Check the form and try again.",
};

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };
const COMMON: Record<Common["status"], string> = {
  logged_out: "Your session has ended. Log in again.",
  not_allowed: "You can't change shifts.",
  error: "Something went wrong. Try again.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One line per problem: "Line 2: That start time has already passed." or the form-wide ones.
export function createProblems(
  result: Extract<CreateShiftsResult, { status: "invalid" }>,
): string[] {
  return result.problems.map((p) =>
    p.line === null
      ? SHIFT_PROBLEM_TEXT[p.problem]
      : `Line ${p.line}: ${SHIFT_PROBLEM_TEXT[p.problem]}`,
  );
}

export function createResultText(result: CreateShiftsResult | Common): string {
  switch (result.status) {
    case "created":
      return result.shiftIds.length === 1
        ? "Shift created."
        : `${plural(result.shiftIds.length, "shift", "shifts")} created.`;
    case "invalid":
      return "Check the form: nothing has been saved.";
    default:
      return COMMON[result.status];
  }
}

export function editResultText(result: EditShiftResult | Common): string {
  switch (result.status) {
    case "saved":
      return "Saved.";
    case "unchanged":
      return "Nothing changed.";
    case "invalid":
      return result.problems.map((p) => SHIFT_PROBLEM_TEXT[p]).join(" ");
    case "has_bookings":
      return 'People are booked on this shift, so its date, times, role and site can\'t change here. Use "Move, shorten or cancel" below: everyone booked is told.';
    case "below_bookings":
      return "There are more people booked than that. Cancel a booking first, or keep more places.";
    case "not_open":
      return "This shift has started or was cancelled, so it can't be changed.";
    case "sheet":
      return "This shift comes from your Google Sheet. Change it there.";
    case "not_found":
      return "We can't find that shift.";
    default:
      return COMMON[result.status];
  }
}

// What a checked file would do, or what the import did, then each problem by row.
export function importResultLines(result: ShiftImportResult | Common): string[] {
  switch (result.status) {
    case "done": {
      const r: ImportResult = result.result;
      const counts = r.dryRun
        ? `This file would add ${plural(r.created, "shift", "shifts")}, change ${r.updated}, leave ${r.unchanged} as they are and skip ${r.skipped}.`
        : `Imported: ${plural(r.created, "shift", "shifts")} added, ${r.updated} changed, ${r.unchanged} left as they were, ${r.skipped} skipped.`;
      return [counts, ...r.problems.map((p) => `Row ${p.row}: ${PROBLEM_TEXT[p.problem]}.`)];
    }
    case "file_error":
      return [FILE_ERROR_TEXT[result.code]];
    case "too_big":
      return ["The file is too big for the web (1 MB at most). Split it into smaller files."];
    case "agreement_needed":
      return [AGREEMENT_NEEDED_TEXT];
    default:
      return [COMMON[result.status]];
  }
}

export function assignResultText(result: BookingResult | Common, name: string): string {
  switch (result.status) {
    case "booked":
      return result.overridden.length > 0
        ? `${name} is booked on this shift. The override is in the log, and your reason is kept with the booking.`
        : `${name} is booked on this shift.`;
    case "not_eligible":
      return `${name} can't be booked: ${result.reasons.join(" ")}`;
    case "filled":
      return "Every place is taken.";
    case "already_assigned":
      return `${name} is already booked on this shift.`;
    case "not_open":
      return "This shift isn't open (a draft, or cancelled).";
    case "not_found":
      return "We can't find that shift or person.";
    case "source_stale":
      return "We can't confirm against your Google Sheet right now. Try again in a few minutes.";
    case "invalid_reason":
      return "Give a reason for the override (no phone numbers or email addresses).";
    case "not_yet":
      return "Try again in a few minutes.";
    case "needs_approval":
      return "This rota can't be changed from here.";
    default:
      return COMMON[result.status];
  }
}

type NoReason = { status: "no_reason" };
const NO_REASON = "Choose a reason.";

export function moveResultLines(result: MoveShiftResult | Common | NoReason): string[] {
  switch (result.status) {
    case "moved":
    case "curtailed": {
      const what = result.status === "moved" ? "Moved" : "Shortened";
      const told =
        result.told === 0
          ? "Nobody was booked on it."
          : `${plural(result.told, "person", "people")} booked will be told. Their notice: ${noticeText(result.noticeHours)}.`;
      return [
        `${what}. ${told}`,
        ...result.warnings.map(
          (w) => `${w.name} may not be able to work the new time: ${w.reasons.join(" ")}`,
        ),
      ];
    }
    case "unchanged":
      return ["Nothing changed."];
    case "blocked":
      return [
        "Not moved: these people can't work the new time, for reasons that can't be overridden. Cancel their bookings first (they'll be told), then move it.",
        ...result.workers.map((w) => `${w.name}: ${w.reasons.join(" ")}`),
      ];
    case "invalid":
      return [SHIFT_PROBLEM_TEXT[result.problem]];
    case "not_open":
      return ["This shift has started or was cancelled, so it can't be moved."];
    case "sheet":
      return ["This shift comes from your Google Sheet. Change it there."];
    case "not_found":
      return ["We can't find that shift."];
    case "no_reason":
      return [NO_REASON];
    default:
      return [COMMON[result.status]];
  }
}

export function cancelShiftResultText(result: CancelShiftResult | Common | NoReason): string {
  switch (result.status) {
    case "cancelled":
      return result.bookings === 0
        ? "Shift cancelled. Nobody was booked on it."
        : `Shift cancelled. ${plural(result.bookings, "person", "people")} booked will be told, and the notice they had is logged.`;
    case "unchanged":
      return "This shift is already cancelled.";
    case "started":
      return "This shift has started, so it can't be cancelled.";
    case "sheet":
      return "This shift comes from your Google Sheet. Change it there.";
    case "not_found":
      return "We can't find that shift.";
    case "no_reason":
      return NO_REASON;
    default:
      return COMMON[result.status];
  }
}

export function cancelBookingResultText(
  result: CancelBookingResult | Common | NoReason,
  name: string,
): string {
  switch (result.status) {
    case "cancelled":
      return `Cancelled ${name}'s booking with ${noticeText(result.noticeHours)}. They'll be told.`;
    case "not_assigned":
      return `${name} isn't booked on this shift any more.`;
    case "ended":
      return "This shift has ended, so bookings on it can't be cancelled.";
    case "started":
      return "This shift has started.";
    case "needs_approval":
      return "This rota can't be changed from here.";
    case "not_found":
      return "We can't find that shift or person.";
    case "no_reason":
      return NO_REASON;
    default:
      return COMMON[result.status];
  }
}

// Who worked it (docs/screens.md, the shift's "Places", once it has started).
export function attendanceResultText(result: MarkAttendanceResult | Common, name: string): string {
  switch (result.status) {
    case "marked":
      return result.outcome === "completed"
        ? `Marked ${name} as worked.`
        : `Marked ${name} as not attended.`;
    case "unchanged":
      return `${name} is already marked that way.`;
    case "not_started":
      return "This shift hasn't started yet.";
    case "not_booked":
      return `${name} isn't booked on this shift any more.`;
    case "not_found":
      return "We can't find that shift or person.";
    default:
      return COMMON[result.status];
  }
}

export function restWorkedResultText(result: MarkRestWorkedResult | Common): string {
  switch (result.status) {
    case "marked":
      return result.count === 0
        ? "Everyone was already marked."
        : `Marked ${plural(result.count, "person", "people")} as worked.`;
    case "not_ended":
      return "This shift hasn't ended yet. Mark each person instead.";
    case "not_found":
      return "We can't find that shift.";
    default:
      return COMMON[result.status];
  }
}
