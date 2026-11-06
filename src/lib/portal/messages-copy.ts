import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { tryAgainText } from "./copy";
import { roleLabel } from "./format";
import type { MessageAbout } from "./message-office";

// The words of a casual's Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat";
// Phase 28.6, docs/screens.md "### 28.6"). Browser-safe: no server imports.

// What happens to a message, as it does (src/lib/inbound/reply.ts), in two sentences (Phase 28.6):
// shifts, cancelling and pay get an automatic answer straight away; a pay answer is a link to Pay,
// where a pay query reaches payroll (golden rule 9: never an AI answer to a pay dispute); anything
// else goes to the office.
export const MESSAGES_INTRO =
  "Ask about shifts, cancelling or pay for an answer straight away, or ask the office anything else. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll.";
export const MESSAGES_EMPTY = "No messages yet.";
// Not "Write to the office" (Phase 28.6): the first answer is often automatic.
export const COMPOSER_LABEL = "Your message";
export const SENT_WAITING = "Sent. The answer comes here.";

// Message the office about a shift (Phase 28.6; 28.2's link, src/lib/portal/message-office.ts):
// the sentence put in her box for each topic, hers to change before she sends; "other" puts none.
export const READY_SENTENCES: Record<MessageAbout, string> = {
  pay: "What's the pay for this shift?",
  late: "I'm running late. I'll be there about …",
  started: "This shift has started and I need to talk to someone.",
  other: "",
};
// Sent about a shift: a person answers it, never an automatic answer (src/lib/inbound/reply.ts).
export const SENT_TO_OFFICE = "Sent. The office will answer here.";

const pad = (n: number) => String(n).padStart(2, "0");

// "About: Steward · Sat 7 Nov, 10:30": the shift's role, its day and its start, in the firm's time.
export function aboutLine(shift: { role: string; startsAt: Date }, timeZone: string): string {
  const w = wallTimeOf(shift.startsAt, timeZone);
  const day = dayLabel(localDateOf(shift.startsAt, timeZone));
  return `About: ${roleLabel(shift.role)} · ${day}, ${pad(w.hour)}:${pad(w.minute)}`;
}
// Who an answer is from, under it.
export const FROM_WORDS = { automatic: "Automatic reply", office: "From the office" } as const;

// The tab's count, for screen readers: "Messages, 1 new reply".
export const messagesCountWords = (n: number) => (n === 1 ? "1 new reply" : `${n} new replies`);

export type SendProblem = "empty" | "too_long" | "rate_limited" | "error";

export function sendProblemText(problem: SendProblem, online?: boolean): string {
  switch (problem) {
    case "empty":
      return "Write a message first.";
    case "too_long":
      return "That's too long (1,600 characters at most).";
    case "rate_limited":
      return "You've sent a lot of messages. Wait a few minutes, then try again.";
    case "error":
      return tryAgainText(online);
  }
}
