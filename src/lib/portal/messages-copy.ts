import { tryAgainText } from "./copy";

// The words of a casual's Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat").
// Browser-safe: no server imports.

// What happens to a message, as it does (src/lib/inbound/reply.ts): shifts, cancelling and pay get
// an automatic answer straight away; a pay answer is a link to Pay, where a pay query reaches
// payroll (golden rule 9: never an AI answer to a pay dispute); anything else goes to the office.
export const MESSAGES_INTRO =
  "Ask about your shifts, cancelling or pay and get an answer straight away. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll. Anything else goes to the office, and their reply comes here.";
export const MESSAGES_EMPTY = "No messages yet.";
export const COMPOSER_LABEL = "Write to the office";
export const SENT_WAITING = "Sent. The answer comes here.";
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
