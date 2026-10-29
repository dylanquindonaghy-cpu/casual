import type { ImportFileErrorCode } from "./errors";
import type { ImportProblemCode, ImportResult } from "./import";

// Plain words for the office (docs/screens.md: short sentences, plain words). Used by the import
// script now and the office import screen later.

export const FILE_ERROR_TEXT: Record<ImportFileErrorCode, string> = {
  empty: "The file has no rows under its header.",
  too_big: "The file is too big. Split it into smaller files (5 MB at most).",
  too_many_rows: "The file has too many rows. Split it into files of 5,000 rows or fewer.",
  too_many_columns: "The file has too many columns. Keep only the ones the import needs.",
  bad_csv: "The CSV file isn't laid out properly: a quote mark is never closed.",
  bad_xlsx: "We can't read this Excel file. Save it again as .xlsx or .csv.",
  old_excel: "This is an old Excel file (.xls). Save it as .xlsx or .csv, then try again.",
  not_text:
    "We can't read this file's text. In Excel, save it as \"CSV UTF-8 (Comma delimited)\" or as .xlsx, then try again.",
  missing_column: "A column the import needs is missing. Check the header row.",
  duplicate_column: "Two columns have the same meaning. Keep one of them.",
};

// Gate B (src/lib/imports/gate-b.ts): the office's words when the live server won't save a file yet.
export const AGREEMENT_NEEDED_TEXT =
  "Nothing was saved: real staff data can be imported once your firm's agreement and data processing agreement with us are signed and recorded. Ask us to record them. You can still check a file.";

export const PROBLEM_TEXT: Record<ImportProblemCode, string> = {
  missing_value: "a required cell is empty",
  bad_mobile: "the mobile number isn't a mobile we can text",
  bad_email: "the email address isn't valid",
  bad_role: "a role has characters we can't use",
  bad_status:
    "the status isn't active, inactive or blocked (for credentials: valid, expired, applied or suspended)",
  bad_date: "the date isn't a date we can read (use 07/11/2026)",
  bad_time:
    "the start or finish isn't a time we can read (use 09:00), or they're the same, 24 hours or more apart, or in the hour the clocks skip in March",
  bad_headcount: "the number needed isn't a whole number from 1 to 1000",
  bad_type: "the credential type has characters we can't use",
  text_too_long: "a cell has too much text",
  unknown_worker: "no worker here has that staff ID or mobile",
  duplicate_row: "the same entry appears earlier in the file",
  duplicate_mobile: "another worker already has that mobile number",
  name_mismatch:
    "that mobile belongs to a worker with another name, so nothing was changed: check the mobile and the name (the number may be someone else's now). For someone who changed their name, see Staff IDs in the import help",
  name_needed:
    "a row without a Staff ID needs the worker's name too (First name and Last name, or Name), to check the mobile is theirs",
  identity_change:
    "this Staff ID's name and mobile have both changed, so nothing was changed: if it's a new person, give them a new Staff ID; if it's the same person, change one at a time",
  shift_has_bookings:
    "people are booked on this shift, so its times, role and site can't change here and the number needed can't go down",
  shift_started: "this shift has already started, so an import can't add or change it",
  bad_hours: "the hours aren't a number we can read (use 37.5)",
  bad_money: "an amount isn't money we can read (use 12.50)",
  bad_period: "the pay period ends before it starts",
};

export function summarise(result: ImportResult): string {
  const lines = [
    `${result.dryRun ? "Dry run (nothing saved): would" : "Imported:"} create ${result.created}, update ${result.updated}, leave ${result.unchanged} unchanged, skip ${result.skipped}.`,
    // Rows the firm's name map says aren't ours (P3.2; the owner's command, so its own words).
    ...(result.ignored
      ? [
          `Left out ${result.ignored} ${result.ignored === 1 ? "row" : "rows"} the firm's name map skips (npm run firm:names).`,
        ]
      : []),
    ...result.problems.map((p) => `Row ${p.row}: ${PROBLEM_TEXT[p.problem]}.`),
  ];
  return lines.join("\n");
}
