import { SHEET_LOCALE_ERROR } from "./client";

// Plain words for a failed sync's code (roster_sources.last_error_code, `roster.sync_failed`):
// for the office's action log, the onboarding checklist and `npm run firm:sheet`. Each says what
// happened and, where the firm can fix it, how. docs/runbooks.md "Google Sheets sync failing" has
// what we do about each.

const WORDS: Record<string, string> = {
  [SHEET_LOCALE_ERROR]:
    "the sheet's locale isn't United Kingdom, so its dates could be read the wrong way round. In Google Sheets: File, Settings, Locale: United Kingdom, then Save settings. Then check the sheet's dates: ones typed before the change may have moved",
  sheet_unreadable:
    "Google couldn't read the sheet: check it's a Google Sheet (not an Excel file) and its tabs still have the names agreed (Staff and Shifts, unless you were told others)",
  sheet_not_shared: "the sheet isn't shared with our Google account (share it again, as Editor)",
  sheet_not_found: "the sheet can't be found (it was deleted, or the link is wrong)",
  missing_column: "a column heading the app reads is missing or was renamed (check row 1)",
  duplicate_column: "two columns have the same heading (check row 1)",
  sheets_rate_limited: "Google asked us to slow down; it tries again shortly",
  sheets_unavailable: "Google didn't answer; it tries again shortly",
  sheets_bad_response: "Google's answer couldn't be read; it tries again shortly",
  sheets_auth_failed: "Google refused our sign-in (ours to fix)",
  bad_mapping: "the sheet's column settings are broken (ours to fix)",
  sync_error: "something went wrong on our side; it tries again shortly",
};

export function syncErrorWords(code: string): string {
  return (
    (Object.hasOwn(WORDS, code) ? WORDS[code] : undefined) ?? "an error we don't have words for yet"
  );
}
