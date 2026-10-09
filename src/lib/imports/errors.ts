// A file the importer can't read at all. The code is what the office sees (in plain words, later)
// and what gets logged: never the file's contents.
export const IMPORT_FILE_ERRORS = [
  "empty", // no rows, or only a header
  "too_big", // over MAX_FILE_BYTES
  "too_many_rows", // over MAX_ROWS data rows
  "too_many_columns",
  "bad_csv", // e.g. a quote that never closes
  "bad_xlsx", // not a readable .xlsx workbook
  "old_excel", // a binary .xls: save as .xlsx or .csv
  "not_text", // not UTF-8 text and not a workbook
  "missing_column", // a required column has no header
  "duplicate_column", // a header appears twice
] as const;
export type ImportFileErrorCode = (typeof IMPORT_FILE_ERRORS)[number];

export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(`import: ${code}`);
    this.name = "ImportFileError";
  }
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 20 * 1024 * 1024; // any one part of a workbook, once unzipped
export const MAX_ROWS = 5000; // data rows, not counting the header
export const MAX_COLUMNS = 50;
