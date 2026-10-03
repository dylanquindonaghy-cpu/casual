// Personal data never reaches the logs (docs/compliance.md). Everything the logger writes goes
// through redact(): phone numbers and email addresses in any string (and any object key) are
// masked, values that could quote user input are withheld, fields whose names suggest secrets or
// personal data are replaced, and only code locations survive from stack traces.
// One masker for the logger, the console (src/lib/log/console.ts) and the console transport.

// Keeps the country code and last 3 digits of a known E.164 number: +447700900123 -> +44*******123.
export function maskPhone(e164: string): string {
  return e164.slice(0, 3) + "*".repeat(Math.max(0, e164.length - 6)) + e164.slice(-3);
}

const WITHHELD = "[withheld]";

// UUIDs, ISO dates/times and Twilio ids are cut out before phone matching so their digits aren't
// mistaken for a phone number, and so a date next to a phone number can't shield it. A Twilio id
// (a message SM…, a call CA…, a recording RE…) is two capital letters then exactly 32 lowercase hex
// characters, standing alone: about 1 in 12 has a run of 10 or more digits, which would otherwise
// be masked as a phone number (and the action log would refuse an event holding one: audit finding
// M12). Matched case-sensitively, so a person's typed number can't pass for one.
const PROTECTED =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?)?|(?<![A-Za-z0-9])[A-Z]{2}[0-9a-f]{32}(?![A-Za-z0-9])/g;
// Anything that looks like a phone number as people type it: an optional + or 00, then 10 or
// more digits with up to 3 spaces, dots, hyphens or brackets between each (07700 900123,
// +44 (0)7700 900123, 0044-7700-900123), even when glued to letters (Mob07700900123). No upper
// bound: a long run (a date or job number right before a phone) is masked as one piece, keeping
// only its last 3 digits. Separators and digits never overlap, so matching stays linear.
// Over-masking a long number that isn't a phone is harmless.
const PHONE = /(?<!\d)(?:\+|00)?\(?\d(?:[\s.()-]{0,3}\d){9,}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// drizzle's DrizzleQueryError message is the SQL plus every parameter, wherever it's quoted.
const FAILED_QUERY = /Failed query:[\s\S]*/g;
// Postgres quotes the offending input: invalid input syntax for type uuid: "Priya ...",
// value "..." is out of range. Withhold any quoted value after a colon or the word value.
const QUOTED_VALUE = /(:\s*|\bvalue\s+)"(?:[^"\\]|\\.)*"/gi;
// Query strings and fragments can carry tokens, codes and numbers (login links, ?mobile=).
const URL_TAIL = /((?:https?:\/\/[^\s"'<>?#]+)|(?:\/[\w.~%/-]*))[?#][^\s"'<>]*/gi;

function maskPhones(segment: string): string {
  return segment.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, "").length;
    if (digits < 10) return match;
    let seen = 0;
    // Keep separators and the last 3 digits; star the rest.
    return match.replace(/\d/g, (d) => (++seen > digits - 3 ? d : "*"));
  });
}

// %2B447700900123 and 07700%20900123 are phone numbers too.
function percentDecode(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

export function maskText(input: string): string {
  const text = percentDecode(input)
    .replace(FAILED_QUERY, "Failed query (details withheld)")
    .replace(QUOTED_VALUE, (_, lead: string) => `${lead}"${WITHHELD}"`)
    .replace(URL_TAIL, (_, base: string) => `${base}?${WITHHELD}`)
    .replace(EMAIL, "***@$1");
  // Mask phones only outside UUIDs and dates.
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PROTECTED)) {
    out += maskPhones(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + maskPhones(text.slice(last));
}

// Field names (matched loosely: case, "_" and "-" ignored, anywhere in the name) whose values
// are never logged.
const SECRET_KEY =
  /token|secret|passw|apikey|privatekey|signature|otp|cookie|authoriz|connectionstring|databaseurl|dsn|codehash|credential/;
const PERSONAL_KEY =
  /firstname|lastname|fullname|displayname|surname|username|^name$|email|mobile|phone|^body$|messagebody|address|postcode|birth|^dob$|^ip$|ipaddress|clientip|useragent/;
// Database/driver error fields that quote row data or query parameters.
const DROP_KEY =
  /^(detail|where|hint|internalquery|internalposition|query|params|parameters|values)$/;

const normalise = (key: string) => key.toLowerCase().replace(/[_-]/g, "");

const MAX_DEPTH = 5;
const MAX_ITEMS = 50;

// A real stack frame: "at fn (file:line:col)", "at file:line:col", "(native)", "(index N)".
const FRAME = /^at .*(?::\d+:\d+\)?|\(native\)|\(index \d+\)|<anonymous>\)?)$/;

// A stack's first lines repeat the message (which may be user input): cut that off when we know
// it, then keep only lines shaped like real frames, masked.
function stackFrames(stack: string, message?: string): string[] {
  const at = message ? stack.indexOf(message) : -1;
  const frames = at >= 0 ? stack.slice(at + (message ?? "").length) : stack;
  return frames
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => FRAME.test(line))
    .slice(0, 10)
    .map(maskText);
}

function redactError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: maskText(err.message) };
  for (const [key, value] of Object.entries(err)) {
    if (key === "message" || key === "name" || key === "cause" || key === "stack") continue;
    out[maskText(key)] = redactField(key, value, depth + 1, seen);
  }
  if (err.stack) out.stack = stackFrames(err.stack, err.message);
  if (err.cause !== undefined) out.cause = redactValue(err.cause, depth + 1, seen);
  return out;
}

function redactField(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  const k = normalise(key);
  if (SECRET_KEY.test(k) || PERSONAL_KEY.test(k)) return "[redacted]";
  if (DROP_KEY.test(k)) return WITHHELD;
  if (k === "stack") return typeof value === "string" ? stackFrames(value) : WITHHELD;
  // A Postgres SQLSTATE (always 5 characters: 23505, 22P02) is useful; any other string of
  // digits under "code" may be an OTP (6 digits).
  if (k === "code" && !/^[0-9A-Z]{5}$/.test(String(value)) && /^\d+$/.test(String(value))) {
    return WITHHELD;
  }
  return redactValue(value, depth, seen);
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "bigint") return maskText(value.toString());
  // A phone number stored as a number (447700900123) is still a phone number.
  if (typeof value === "number") return Math.abs(value) >= 1e9 ? maskText(String(value)) : value;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[circular]";
  if (depth > MAX_DEPTH) return "[deep]";
  seen.add(value);
  if (value instanceof Error) return redactError(value, depth, seen);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1, seen));
  }
  if (Buffer.isBuffer(value)) return "[bytes]";
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[maskText(key)] = redactField(key, v, depth + 1, seen);
  }
  return out;
}

export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}
