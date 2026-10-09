import { readFileSync } from "node:fs";
import { CONSOLE_PRINT_END, CONSOLE_PRINT_START } from "../src/lib/messaging/console";

// Looks through log output for phone numbers, email addresses and login tokens that got past the
// log masker (docs/testing.md "Pre-pilot checklist": "Log masking verified"). Its own patterns,
// simpler and broader than the masker's (src/lib/log/mask.ts), so it doesn't pass just by agreeing
// with it:
// - any run of 10 to 15 digits (spaces or dashes allowed between, a + or 00 in front) that isn't
//   part of a longer number or a decimal, even before a full stop or glued to letters, "_" or "-"
//   ("call 07700 900123.", "Mob07700900123": audit L52);
// - anything shaped like name@domain.tld;
// - a login link's token (/l#… or /office/l#…) and a session cookie's value (audit L53),
// after undoing URL and form escapes (+ for a space, %2B, %40). UUIDs, ISO times, long hex ids,
// Twilio ids and bare Unix times are taken out (they aren't personal and their digits would look
// like numbers).
// Prints where each one is, with the value itself masked, so the scan's own output is safe to share.
//
//   npm run -s logs:scan -- <file> [<file> …]        or    docker compose logs web worker | npm run -s logs:scan

export interface LogFinding {
  line: number;
  kind: "phone" | "email" | "token";
  masked: string;
}

const NOT_PERSONAL = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, // ISO times
  /\b[0-9a-f]{20,}\b/gi, // long hex ids (hashes, request ids)
  /(?<![A-Za-z0-9])[A-Z]{2}[0-9a-f]{32}(?![A-Za-z0-9])/g, // Twilio ids (SM…, CA…, RE…)
  /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g, // IPv4 addresses
];
// Not part of a longer number (no digit just before or after) and not a decimal's fraction or
// whole part (no "digit." just before, no ".digit" just after); anything else around it is fine.
// Up to 3 spaces, tabs, dots or dashes between digits, as the masker allows ("07700 - 900 123",
// "+44.7700.900123"); a number whose only separator is one dot is a decimal, not a phone.
const PHONE = /(?<!\d)(?<!\d\.)(?:\+|00)?\d(?:[ \t.-]{0,3}\d){9,14}(?!\d)(?!\.\d)/g;
const DECIMAL = /^[+\d]*\.\d+$/;
// A login link's token (43 characters: 32 random bytes) and a session cookie's value.
const TOKEN = /\/l#[A-Za-z0-9_-]{43}|sd_(?:session|office)=[A-Za-z0-9_-]{20,}/g;
// A bare run of 10 or 13 digits starting with 1: a Unix time in seconds or milliseconds, not a
// phone number (UK numbers start 0 or +44).
const EPOCH = /^1\d{9}(\d{3})?$/;

// Undo how numbers get written in URLs and forms before looking: %2B447700900123, 07700+900123 (a
// form's space), %40 in an email, (07700) 900123, a non-breaking space.
function unescape(line: string): string {
  let text = line.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  text = text.replace(/(\d)\+(?=\d)/g, "$1 ").replace(/\u00a0/g, " ");
  return text.replace(/\((\d{2,6})\)\s?/g, "$1 ");
}
// An email, found from its "@" (so a long line costs one pass: audit M13, as in the masker), then
// back over the part before it.
const EMAIL_DOMAIN = /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_LOCAL = /[A-Za-z0-9._%+-]/;
function emails(line: string): { at: number; end: number; text: string }[] {
  const found: { at: number; end: number; text: string }[] = [];
  let last = 0;
  for (const m of line.matchAll(EMAIL_DOMAIN)) {
    let start = m.index;
    while (start > last && EMAIL_LOCAL.test(line[start - 1] ?? "")) start -= 1;
    if (start === m.index) continue;
    last = m.index + m[0].length;
    found.push({ at: start, end: last, text: line.slice(start, last) });
  }
  return found;
}
const withoutEmails = (line: string) =>
  emails(line).reduceRight((text, e) => `${text.slice(0, e.at)} ${text.slice(e.end)}`, line);

// The number without its UK country code or leading 0, so +44 7700 900000, 0044… and 07700 900000
// compare equal.
const nationalDigits = (value: string) => value.replace(/\D/g, "").replace(/^(0044|44|0)/, "");

const mask = (value: string) =>
  value.length <= 4
    ? "****"
    : `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;

// `allowNumbers`: business numbers that may appear (a firm's own shifts line), compared digit for
// digit; any other number is still a finding.
export function scanLogText(text: string, opts: { allowNumbers?: string[] } = {}): LogFinding[] {
  const allowed = new Set((opts.allowNumbers ?? []).map(nationalDigits));
  const findings: LogFinding[] = [];
  text.split("\n").forEach((raw, i) => {
    let line = unescape(raw);
    for (const re of NOT_PERSONAL) line = line.replace(re, " ");
    // On the line as written and with its %-escapes undone (%2Fl%23… is a login link too).
    for (const m of new Set(
      [...raw.matchAll(TOKEN), ...unescape(raw).matchAll(TOKEN)].map((t) => t[0]),
    )) {
      findings.push({ line: i + 1, kind: "token", masked: mask(m) });
    }
    for (const e of emails(line)) {
      findings.push({ line: i + 1, kind: "email", masked: mask(e.text) });
    }
    for (const m of withoutEmails(line).matchAll(PHONE)) {
      if (allowed.has(nationalDigits(m[0])) || EPOCH.test(m[0]) || DECIMAL.test(m[0])) continue;
      findings.push({ line: i + 1, kind: "phone", masked: mask(m[0]) });
    }
  });
  return findings;
}

export function scanReport(name: string, findings: LogFinding[]): string {
  if (findings.length === 0) {
    return `${name}: no phone numbers, email addresses or login tokens.`;
  }
  const lines = findings.slice(0, 50).map((f) => `  line ${f.line}: ${f.kind} ${f.masked}`);
  return [
    `${name}: ${findings.length} possible phone numbers, emails or login tokens:`,
    ...lines,
  ].join("\n");
}

// The text with the console transport's own printed messages blanked out (line numbers kept). They
// show message bodies whole, login links included, on purpose (src/lib/messaging/console.ts), so
// the e2e run checks for tokens everywhere else. Only a whole message is left out: its exact first
// line, then its end line before any line of our JSON log or another message starts. Anything else
// (a line that only starts like one, a message with no end line) is checked like the rest.
const CONSOLE_HEADER = new RegExp(
  `^${CONSOLE_PRINT_START.replace(/[[\]]/g, "\\$&")}(?:whatsapp|sms|email) to \\S+(?: from \\S+)? \\(console-[0-9a-f-]{36}\\)$`,
);
export function withoutConsoleMessages(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!CONSOLE_HEADER.test(lines[i] ?? "")) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (
      end < lines.length &&
      lines[end] !== CONSOLE_PRINT_END &&
      !(lines[end] ?? "").startsWith('{"ts":') &&
      !CONSOLE_HEADER.test(lines[end] ?? "")
    ) {
      end += 1;
    }
    if (lines[end] === CONSOLE_PRINT_END) {
      for (let k = i; k <= end; k += 1) lines[k] = "";
      i = end + 1;
    } else {
      i = end;
    }
  }
  return lines.join("\n");
}

// Run as a command.
if (process.argv[1]?.endsWith("logs-scan.ts")) {
  const files = process.argv.slice(2);
  const inputs =
    files.length > 0
      ? files.map((f) => [f, readFileSync(f, "utf8")] as const)
      : [["(stdin)", readFileSync(0, "utf8")] as const];
  let total = 0;
  for (const [name, text] of inputs) {
    const findings = scanLogText(text);
    total += findings.length;
    console.log(scanReport(name, findings));
  }
  process.exit(total === 0 ? 0 : 1);
}
