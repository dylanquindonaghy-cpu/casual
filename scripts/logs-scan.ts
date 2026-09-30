import { readFileSync } from "node:fs";

// Looks through log output for phone numbers and email addresses that got past the log masker
// (docs/testing.md "Pre-pilot checklist": "Log masking verified"). Its own patterns, simpler and
// broader than the masker's (src/lib/log/mask.ts), so it doesn't pass just by agreeing with it:
// any run of 10 to 15 digits (spaces or dashes allowed between, a + or 00 in front) that isn't part
// of a longer word or a decimal, and anything shaped like name@domain.tld, after undoing URL and
// form escapes (+ for a space, %2B, %40). UUIDs, ISO times, long hex ids and bare Unix times are
// taken out (they aren't personal and their digits would look like numbers).
// Prints where each one is, with the value itself masked, so the scan's own output is safe to share.
//
//   npm run -s logs:scan -- <file> [<file> …]        or    docker compose logs web worker | npm run -s logs:scan

export interface LogFinding {
  line: number;
  kind: "phone" | "email";
  masked: string;
}

const NOT_PERSONAL = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, // ISO times
  /\b[0-9a-f]{20,}\b/gi, // long hex ids (hashes, request ids)
];
const PHONE = /(?<![\w.@-])(?:\+|00)?\d(?:[ -]?\d){9,14}(?![\w@.-])/g;
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
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

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
    for (const m of line.matchAll(EMAIL)) {
      findings.push({ line: i + 1, kind: "email", masked: mask(m[0]) });
    }
    for (const m of line.replace(EMAIL, " ").matchAll(PHONE)) {
      if (allowed.has(nationalDigits(m[0])) || EPOCH.test(m[0])) continue;
      findings.push({ line: i + 1, kind: "phone", masked: mask(m[0]) });
    }
  });
  return findings;
}

export function scanReport(name: string, findings: LogFinding[]): string {
  if (findings.length === 0) return `${name}: no phone numbers or email addresses.`;
  const lines = findings.slice(0, 50).map((f) => `  line ${f.line}: ${f.kind} ${f.masked}`);
  return [`${name}: ${findings.length} possible phone numbers or emails:`, ...lines].join("\n");
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
