import type { ResolvePayQueriesResult } from "../pay/resolve";

// "Mark as sorted and tell them" on payroll's page, in plain words (docs/screens.md
// `/office/pay-queries`). Apart from the digest's words: this path imports nothing that reaches AI
// code (tests/unit/ai.boundary.test.ts).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

const queries = (n: number) => (n === 1 ? "1 query" : `${n} queries`);

export function sortText(result: ResolvePayQueriesResult | Common): string {
  switch (result.status) {
    case "sorted":
      return `Marked as sorted: ${queries(result.count)}.${
        result.skipped > 0
          ? ` ${result.skipped === 1 ? "1 was" : `${result.skipped} were`} already sorted by someone else.`
          : ""
      } Each person will get your note by message.`;
    case "already":
      return "These were already sorted by someone else.";
    case "note_needed":
      return "Tell them what payroll did first.";
    case "note_too_long":
      return "That's too long (500 characters at most).";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "not_allowed":
      return "You can't sort pay queries.";
    case "error":
      return "Something went wrong. Try again.";
  }
}
