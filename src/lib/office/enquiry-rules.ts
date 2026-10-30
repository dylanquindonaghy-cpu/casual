// Enquiries' rules (docs/office-v2.md 3.6; 12D.1), as pure functions: the outcome label of a
// message from what was logged about it, WhatsApp's 24-hour window, and how the office's reply goes.
// No database code (the reply form, a client component, uses it: tests/unit/client-boundary.test.ts).
// Labels come from code only, never from AI.

// How long a casual's WhatsApp lets the business answer in its own words. From then on, only an
// approved template (WhatsApp Business policy).
export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;

// The office's reply, as typed: one line (the template's variable can't hold a line break) of at
// most this many characters (a question's resolution note holds 500).
export const REPLY_MAX = 500;

// "Close without a reply": a code from this list only, never typed text (the log is append-only).
export const CLOSE_REASONS = ["by_phone", "not_for_us", "duplicate", "spam", "other"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const OUTCOMES = [
  "keyword", // Answered by keyword
  "ai", // Sorted by AI, answered from your data
  "person_waiting", // Passed to a person, waiting
  "person_answered", // Passed to a person, answered
  "not_understood", // Not understood
  "pay", // Pay (always a person)
  "in_app", // Done in the app
  "inbox", // Left for your inbox (an email not from a casual: Phase 25.5)
] as const;
export type Outcome = (typeof OUTCOMES)[number];

// What was logged about one message (src/lib/office/enquiries.ts reads it).
export interface OutcomeFacts {
  handled: boolean; // the shifts line's job has sorted it (handled_at)
  handledAs: "keyword" | "ai" | "office" | "unknown" | "opt_out" | null;
  intent: "shifts" | "cancel" | "pay" | "office" | null;
  waiting: boolean; // Need a person (enquiries.ts NEEDS_PERSON)
  doneInApp: boolean; // the casual booked or cancelled in the app within a day of the reply
  email?: boolean; // an email to the staffing inbox (Phase 25.5), not a message to the shifts line
}

// For a person: the casual asked for the office (a keyword or the AI), nothing sorted it (a photo,
// a voicemail, no AI), or the number isn't one of the firm's casuals. An email not from a casual is
// left for the firm's own inbox, where it already is (Phase 25.5): never a person's here.
export const forAPerson = (f: Pick<OutcomeFacts, "handledAs" | "intent" | "email">) =>
  (f.handledAs === "unknown" && !f.email) || f.intent === "office";

export function enquiryOutcome(f: OutcomeFacts): Outcome {
  if (!f.handled) return "not_understood";
  if (f.email && f.handledAs === "unknown") return "inbox";
  // Pay is never answered by AI or by the shifts line's words: the casual gets the pay page's link.
  if (f.intent === "pay") return "pay";
  if (forAPerson(f)) return f.waiting ? "person_waiting" : "person_answered";
  if (f.doneInApp) return "in_app";
  if (f.handledAs === "ai") return "ai";
  return "keyword"; // a keyword, or STOP / START on a text
}

// Inside WhatsApp's window: their last WhatsApp to this line was less than 24 hours ago. At exactly
// 24 hours it has closed.
export function insideWhatsAppWindow(lastWhatsAppAt: Date | null, now: Date): boolean {
  if (!lastWhatsAppAt) return false;
  const age = now.getTime() - lastWhatsAppAt.getTime();
  return age >= 0 && age < WHATSAPP_WINDOW_MS;
}

// How the office's reply goes: by which channel, and as their own words ("free_text") or as the
// `request_update` template ("template"). Always from the firm's shifts line as it is now (an old
// number may belong to another firm by then), so WhatsApp's window runs from their last WhatsApp to
// that line.
export type ReplyPlan =
  | { ok: true; channel: "whatsapp" | "sms"; form: "free_text" | "template" }
  | { ok: false; why: "no_line" | "withheld" | "unknown_caller" | "texts_off" };

export function replyPlan(input: {
  channel: "whatsapp" | "sms" | "voice"; // the message's
  from: string | null; // null: a withheld number
  line: string | null; // the firm's shifts line now (null: none)
  // The casual on file for that number (null: an unknown number). A text to one who replied STOP
  // never goes.
  casual: { notifyChannel: "whatsapp" | "sms"; smsAllowed: boolean } | null;
  strangerTextsOff: boolean; // an unknown number whose last word to the line was STOP
  lastWhatsAppAt: Date | null; // their latest WhatsApp to the line
  now: Date;
}): ReplyPlan {
  if (input.line === null) return { ok: false, why: "no_line" };
  if (input.from === null) return { ok: false, why: "withheld" };
  const whatsapp = (): ReplyPlan => ({
    ok: true,
    channel: "whatsapp",
    form: insideWhatsAppWindow(input.lastWhatsAppAt, input.now) ? "free_text" : "template",
  });
  // A text has no window: the reply is a text in the office's words.
  const textsOff = input.casual ? !input.casual.smsAllowed : input.strangerTextsOff;
  const text = (): ReplyPlan =>
    textsOff ? { ok: false, why: "texts_off" } : { ok: true, channel: "sms", form: "free_text" };
  if (input.channel === "whatsapp") return whatsapp();
  if (input.channel === "sms") return text();
  // A voicemail: by the channel the casual chose (WhatsApp if they replied STOP to texts). Never a
  // message to a caller we don't know (as the shifts line itself: src/lib/inbound/reply.ts): the
  // office phones them back.
  if (!input.casual) return { ok: false, why: "unknown_caller" };
  if (input.casual.notifyChannel === "sms" && input.casual.smsAllowed) return text();
  return whatsapp();
}

// The office's words as one line: runs of spaces, tabs and line breaks become one space.
export const replyLine = (text: string) => text.replace(/\s+/g, " ").trim();

// The office's reply to an email (P7.5): its own lines kept (spaces at line ends and runs of blank
// lines tidied), at most EMAIL_REPLY_MAX characters.
export const EMAIL_REPLY_MAX = 2000;
export const emailReplyText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
