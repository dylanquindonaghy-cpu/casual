import { matchByExample, type MatchableAnswer } from "../answers/match";
import { keywordIntent } from "../inbound/keywords";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { tryAgainText } from "./copy";
import { roleLabel } from "./format";
import type { MessageAbout } from "./message-office";

// The words of a casual's Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat";
// Phase 28.6, docs/screens.md "### 28.6"). Browser-safe: no server imports.

// What happens to a message, as it does (src/lib/inbound/reply.ts): since Phase 35 (the approved
// mock-up's words) common questions, the built-in ones and the firm's own answers, get an answer
// straight away; anything else goes to the office; and, as Phase 28.6 had it, a pay dispute goes to
// payroll by a pay query on Pay (golden rule 9: never an AI answer to a pay dispute).
export const MESSAGES_INTRO =
  "Ask us anything. Common questions are answered straight away; anything else goes to the office. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll.";
// Opened from Pay about a question Pay can't take (28.10; Phase 29.1, Dylan's decision 20): it goes
// to payroll as a pay query, never sorted and never an automatic or AI answer (golden rule 9).
export const MESSAGES_INTRO_PAY =
  "This goes to payroll, not the automatic answers. You'll see their answer on your Pay page.";
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
// Opened about her pay with no shift (the guardrails review of 28.10; Pay's "Message the office"):
// the About line, and an empty box. Sent, payroll answers it on her Pay page (Phase 29.1), never an
// automatic answer.
export const ABOUT_PAY_LINE = "About: your pay";
// Sent about a shift: a person answers it, never an automatic answer (src/lib/inbound/reply.ts).
export const SENT_TO_OFFICE = "Sent. The office will answer here.";
// Sent about her pay (Phase 29.1): a pay query for payroll's digest, answered on her Pay page under
// "Your pay queries", never here. Under that message in her thread afterwards, PAY_QUERY_NOTE, with
// the Pay page's link.
export const SENT_TO_PAYROLL =
  "Sent. Payroll will look at it. You'll see the answer on your Pay page.";
export const PAY_QUERY_NOTE = {
  before: "Sent to payroll. ",
  link: "See it on your Pay page",
} as const;

const pad = (n: number) => String(n).padStart(2, "0");

// "About: Steward · Sat 7 Nov, 10:30": the shift's role, its day and its start, in the firm's time.
export function aboutLine(shift: { role: string; startsAt: Date }, timeZone: string): string {
  const w = wallTimeOf(shift.startsAt, timeZone);
  const day = dayLabel(localDateOf(shift.startsAt, timeZone));
  return `About: ${roleLabel(shift.role)} · ${day}, ${pad(w.hour)}:${pad(w.minute)}`;
}
// "Not what you needed? Ask the office" (Phase 35.4), under the latest of the firm's own answers
// in her thread: it sends her a message to the office naming the answer (askOfficeWords(), below,
// keeps only words the shifts line gives a person), then says so.
export const ASK_OFFICE_BUTTON = "Not what you needed? Ask the office";
export const ASK_OFFICE_SENT = "Sent to the office. They'll answer here.";
// One of her "Ask the office" messages (they all start so): a follow-up, not a new question.
export const ASK_OFFICE_START = "Please can someone from the office help";
export const isAskOffice = (text: string): boolean => text.startsWith(ASK_OFFICE_START);
// The words that go, best first: the answer named, when the name can't steer the message to an
// automatic answer of its own ("Pay day" has "pay": the plain words go instead).
export const askOfficeTexts = (answerName: string): string[] => [
  `Please can someone from the office help? (About: ${answerName})`,
  "Please can someone from the office help with my last question?",
  "Please can someone from the office help?",
];

// The words "Ask the office" sends: the first of askOfficeTexts() the shifts line gives a person by
// the same pure checks its job makes first (src/lib/inbound/reply.ts answerApp): no example question
// of a switched-on answer in it, and the built-in keyword "office" its keyword (cancel, pay and
// shifts come before it: an answer named "Pay day" would get the pay link). Null: none would.
export function askOfficeWords(
  answerName: string,
  library: readonly MatchableAnswer[],
): string | null {
  return (
    askOfficeTexts(answerName).find(
      (t) => keywordIntent(t) === "office" && matchByExample(t, library) === null,
    ) ?? null
  );
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
