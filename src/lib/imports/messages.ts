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
  not_text: "We can't read this file. Use a .csv or .xlsx file.",
  missing_column: "A column the import needs is missing. Check the header row.",
  duplicate_column: "Two columns have the same meaning. Keep one of them.",
};

export const PROBLEM_TEXT: Record<ImportProblemCode, string> = {
  missing_value: "a required cell is empty",
  bad_mobile: "the mobile number isn't a phone number we can read",
  bad_email: "the email address isn't valid",
  bad_role: "a role has characters we can't use",
  bad_status:
    "the status isn't active, inactive or blocked (for credentials: valid, expired, applied or suspended)",
  bad_date: "the date isn't a date we can read (use 07/11/2026)",
  bad_time: "a time isn't a time we can read (use 09:00)",
  bad_headcount: "the number needed isn't a whole number from 1 to 1000",
  bad_type: "the credential type has characters we can't use",
  text_too_long: "a cell has too much text",
  unknown_worker: "no worker here has that staff ID or mobile",
  duplicate_row: "the same entry appears earlier in the file",
  duplicate_mobile: "another worker already has that mobile number",
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
    ...result.problems.map((p) => `Row ${p.row}: ${PROBLEM_TEXT[p.problem]}.`),
  ];
  return lines.join("\n");
}
