import { cutChars } from "../text/cut";

// An email to the staffing inbox, made ready to keep (P7.3; PLAN.md P7), before anything is
// stored: only what the casual wrote this time. Pure.
// - Quoted history goes: everything from a quote's header on ("On … wrote:", "-----Original
//   Message-----", Outlook's "From: … Sent: …" block or its line of underscores, a forwarded
//   message's header), and every line quoted with ">". A reply written below the quote ("On …
//   wrote:" first, then "> …" lines, then the reply) keeps the reply. A forwarded thread with
//   nothing written above it leaves nothing.
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

const WROTE_START = /^\s*On\s.+/i;
const WROTE_END = /\bwrote:\s*$/i;
// Headers after which everything is the earlier mail, never quoted with ">".
const ORIGINAL = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
const FORWARDED = /^\s*(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*$/i;
const UNDERSCORES = /^\s*_{10,}\s*$/;
const OUTLOOK_FROM = /^\s*\*?From:\*?\s.+/i;
const OUTLOOK_NEXT = /^\s*\*?(Sent|Date|To|Subject|Cc):\*?\s/i;
const SIGNATURE = /^-- ?$/;
const PHONE_SIGN_OFF = /^\s*(Sent from my\s.+|Get Outlook for\s.+)$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// "On Mon, 2 Nov 2026 at 09:00, Ann <ann@example.com> wrote:", which mail apps wrap over up to
// three lines: how many lines it takes from here, or 0.
function wroteHeader(lines: string[], i: number): number {
  if (!WROTE_START.test(lines[i] ?? "")) return 0;
  for (let n = 1; n <= 3 && i + n <= lines.length; n++) {
    if (WROTE_END.test(lines.slice(i, i + n).join(" "))) return n;
  }
  return 0;
}

function outlookBlock(lines: string[], i: number): boolean {
  if (!OUTLOOK_FROM.test(lines[i] ?? "")) return false;
  return lines.slice(i + 1, i + 5).some((l) => OUTLOOK_NEXT.test(l));
}

const quoted = (line: string) => /^\s*>/.test(line);
const hasWords = (lines: string[]) => lines.some((l) => l.trim() !== "" && !quoted(l));

export function ownWords(text: string): string | null {
  let lines = text.replace(/\r\n?/g, "\n").replace(CONTROL, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (
      ORIGINAL.test(line) ||
      FORWARDED.test(line) ||
      outlookBlock(lines, i) ||
      (UNDERSCORES.test(line) && outlookBlock(lines, i + 1))
    ) {
      lines = lines.slice(0, i);
      break;
    }
    const wrote = wroteHeader(lines, i);
    if (wrote > 0) {
      // Written above the quote: what's above. Written below it: what's below, unquoted.
      lines = hasWords(lines.slice(0, i))
        ? lines.slice(0, i)
        : [...lines.slice(0, i), ...lines.slice(i + wrote)];
      break;
    }
  }
  lines = lines.filter((l) => !quoted(l));
  const signature = lines.findIndex((l) => SIGNATURE.test(l));
  if (signature >= 0) lines = lines.slice(0, signature);
  lines = lines.filter((l) => !PHONE_SIGN_OFF.test(l)).map((l) => l.trimEnd());
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
