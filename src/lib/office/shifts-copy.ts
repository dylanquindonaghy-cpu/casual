import type { ImportResult } from "../imports/import";
import { PROBLEM_TEXT } from "../imports/messages";
import type { BookingResult } from "../roster/book";
import type { CreateShiftsResult, EditShiftResult, ShiftProblem } from "./shift-editor";
import type { ShiftImportResult } from "./shift-import";
import { FILE_ERROR_TEXT } from "../imports/messages";

// The office's shift screens in plain words (docs/screens.md `/office/shifts`).

export const SHIFT_STATUS_WORDS = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  cancelled: "Cancelled",
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
  bad_time: "Enter the start and finish as times, like 08:00.",
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
      return "People are booked on this shift, so its date, times, role and site can't change here. Moving a booked shift comes with the office's move and cancel screen.";
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
    default:
      return [COMMON[result.status]];
  }
}

export function assignResultText(result: BookingResult | Common, name: string): string {
  switch (result.status) {
    case "booked":
      return result.overridden.length > 0
        ? `${name} is booked on this shift. The override and your reason are in the log.`
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
