// What the Sheets sync needs from Google Sheets, and nothing more: one batch read and one batch
// write per call (Google counts requests against a per-minute quota). The real client is
// google.ts; tests use an in-memory fake. Nothing outside the sync job may hold a SheetsClient:
// portal requests never read or write the sheet (docs/architecture.md).

export interface SheetWrite {
  range: string; // a single cell, e.g. 'Shifts'!J7 (see a1.ts)
  value: string;
}

export interface SheetsClient {
  // Values of each range as rows of cell text, in the order asked. One request.
  batchGet(spreadsheetId: string, ranges: string[]): Promise<string[][][]>;
  // Writes every cell in one request, as plain text (never evaluated as a formula).
  batchUpdate(spreadsheetId: string, writes: SheetWrite[]): Promise<void>;
}

// Error codes the sync stores (roster_sources.last_error_code) and shows the office. Never a
// message from Google or a cell's contents.
export const SHEETS_ERROR_CODES = [
  "sheet_not_shared", // 403: the firm hasn't shared the sheet with our service account
  "sheet_not_found", // 404: wrong spreadsheet id, or deleted
  "sheets_rate_limited", // 429
  "sheets_unavailable", // 5xx, timeouts, network
  "sheets_auth_failed", // our service account's token was refused
  "sheets_bad_response", // a response we couldn't read
] as const;
export type SheetsErrorCode = (typeof SHEETS_ERROR_CODES)[number];

export class SheetsError extends Error {
  constructor(readonly code: SheetsErrorCode) {
    super(`Google Sheets: ${code}`);
    this.name = "SheetsError";
  }
}
