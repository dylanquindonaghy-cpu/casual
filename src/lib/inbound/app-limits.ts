// What a casual's message in the app may hold (P8; Phase 25.6), shared by the form in the browser
// and the server's check (src/lib/inbound/app.ts). Browser-safe: no imports.

export const APP_MESSAGE_MAX = 1600; // characters

// Their words as stored: line endings made plain, NULs (which Postgres refuses) taken out, and the
// ends trimmed.
export const appMessageText = (raw: string): string =>
  raw.replace(/\r\n?/g, "\n").replaceAll("\u0000", "").trim();

// Characters as people count them (an emoji is one), not UTF-16 units.
export const charCount = (text: string): number => [...text].length;
