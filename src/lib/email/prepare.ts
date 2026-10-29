import { cutChars } from "../text/cut";

// An email to the staffing inbox, made ready to keep (P7.3; PLAN.md P7), before anything is
// stored: only what the casual wrote this time. Pure.
// - Quoted history goes: everything from a quote's header on ("On … wrote:", "-----Original
//   Message-----", Outlook's "From: … Sent: …" block or its line of underscores, a forwarded
//   message's header), and every line quoted with ">". A reply written below the quote ("On …
//   wrote:" first, then "> …" lines, then the reply) keeps the reply, up to any older mail under
//   it. A forwarded thread with nothing written above it leaves nothing.
// - The signature goes: from a "-- " line on, and a phone's "Sent from my …" or "Get Outlook for …".
// - Blank lines are tidied, the text capped at BODY_MAX characters and the subject at SUBJECT_MAX,
//   control characters taken out. Nothing left: none (null).
// - Attachments are never kept: only how many there were.
// - Mail that isn't from a known casual keeps neither subject nor words (only who wrote).

export const BODY_MAX = 4000; // inbound_emails_body_length
export const SUBJECT_MAX = 300; // inbound_emails_subject_length

export interface PreparedEmail {
  subject: string | null;
  body: string | null;
  attachments: number;
}

const WROTE_START = /^\s*On\s/i;
const WROTE_END = /\bwrote:\s*$/i;
// A date, as every English "On … wrote:" header gives one: a month's name by a 4-digit year ("2 Nov
// 2026", "Nov 2, 2026", "2 November 2026"), a numeric day, month and year ("02/11/2026",
// "11/2/26", "02.11.2026") or "2026-11-02". Never four digits alone: "1930 to 0300" is a casual's
// shift times.
const DATE =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+(\d{1,2}(st|nd|rd|th)?,?\s+)?(19|20)\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}(\d{2})?\b|\b(19|20)\d{2}-\d{2}-\d{2}\b/i;
// Headers after which everything is the earlier mail, never quoted with ">".
const ORIGINAL = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
const FORWARDED = /^\s*(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*$/i;
const UNDERSCORES = /^\s*_{10,}\s*$/;
// Outlook's "From: Name <address>" with its "Sent:" (or "Date:") under it: never a casual's own
// "From: 10:00 / To: 18:00". Under Outlook's line of underscores the address may be missing (a
// name from the address book).
const OUTLOOK_FROM = /^\s*\*?From:\*?\s/i;
const OUTLOOK_SENT = /^\s*\*?(Sent|Date):\*?\s/i;
const hasAddress = (line: string) => line.includes("@") || /<[^<>]*>/.test(line);
const SIGNATURE = /^-- ?$/;
const PHONE_SIGN_OFF = /^\s*(Sent from my\s.+|Get Outlook for\s.+)$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// A line is looked at for a header by its first HEADER_CHARS characters only: no header is longer,
// and no pattern runs over a line someone made 500,000 characters long.
const HEADER_CHARS = 1000;
const head = (line: string | undefined) => (line ?? "").slice(0, HEADER_CHARS);
// How deep in ">" a line is quoted (any space before or between the marks, a no-break one too).
const depthOf = (line: string) => {
  let depth = 0;
  for (const c of line) {
    if (c === ">") depth += 1;
    else if (!/\s/.test(c)) break;
  }
  return depth;
};

// "On Mon, 2 Nov 2026 at 09:00, Ann <ann@example.com> wrote:", which mail apps wrap over up to
// three lines (quoted too, in a reply to a reply). Found from its "wrote:" line (e), back over at
// most two more lines quoted as deep (never before line `from`), with no blank between, to the
// nearest that starts "On ", and only if it gives a date: the line where it starts. So a casual's
// own "On Sunday I can do 10:00 to 18:00" is never taken for one. With no such line, "Name
// <address> wrote:" (some apps write no "On") is a header by itself; else -1. (A line of theirs
// that starts "On" and gives a date, straight above a header with no "On", is taken for the
// header's start: rare.)
function wroteHeaderStart(lines: string[], e: number, from: number): number {
  const end = head(lines[e]);
  if (!WROTE_END.test(end)) return -1;
  const depth = depthOf(end);
  const alone = hasAddress(end) ? e : -1;
  for (let s = e; s >= Math.max(from, e - 2); s--) {
    const line = head(lines[s]);
    if (line.trim() === "" || depthOf(line) !== depth) return alone;
    if (WROTE_START.test(line.replace(/^[\s>]*/, ""))) {
      const header = lines
        .slice(s, e + 1)
        .map(head)
        .join(" ");
      return DATE.test(header) ? s : alone;
    }
  }
  return alone;
}

function outlookBlock(lines: string[], i: number, needAddress: boolean): boolean {
  const from = head(lines[i]);
  if (!OUTLOOK_FROM.test(from) || (needAddress && !hasAddress(from))) return false;
  return lines.slice(i + 1, i + 5).some((l) => OUTLOOK_SENT.test(head(l)));
}

const quoted = (line: string) => depthOf(head(line)) > 0;
const hasWords = (lines: string[]) => lines.some((l) => l.trim() !== "" && !quoted(l));

// The lines before the quoted history. Written above a quote: what's above. Written below it:
// what's below, looked through the same way, so an older mail further down ("-----Original
// Message-----", another "On … wrote:") is cut off too. (What's above a quote with nothing written
// is blank or quoted, so it's left out.)
function beforeHistory(lines: string[]): string[] {
  let from = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = head(lines[i]);
    if (
      ORIGINAL.test(line) ||
      FORWARDED.test(line) ||
      outlookBlock(lines, i, true) ||
      (UNDERSCORES.test(line) && outlookBlock(lines, i + 1, false))
    ) {
      return lines.slice(from, i);
    }
    const start = wroteHeaderStart(lines, i, from);
    if (start >= 0) {
      if (hasWords(lines.slice(from, start))) return lines.slice(from, start);
      from = i + 1;
    }
  }
  return lines.slice(from);
}

export function ownWords(text: string): string | null {
  let lines = beforeHistory(text.replace(/\r\n?/g, "\n").replace(CONTROL, "").split("\n"));
  lines = lines.filter((l) => !quoted(l));
  const signature = lines.findIndex((l) => SIGNATURE.test(l));
  if (signature >= 0) lines = lines.slice(0, signature);
  lines = lines.filter((l) => !(l.length <= 200 && PHONE_SIGN_OFF.test(l))).map((l) => l.trimEnd());
  const tidy = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return tidy === "" ? null : cutChars(tidy, BODY_MAX);
}

export function prepareEmail(input: {
  subject: string | null;
  text: string | null;
  attachments: number;
  fromKnownCasual: boolean;
}): PreparedEmail {
  const attachments = Math.max(0, Math.min(1000, Math.trunc(input.attachments)));
  if (!input.fromKnownCasual) return { subject: null, body: null, attachments };
  const subject = (input.subject ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return {
    subject: subject === "" ? null : cutChars(subject, SUBJECT_MAX),
    body: input.text === null ? null : ownWords(input.text),
    attachments,
  };
}
