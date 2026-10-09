import type { MESSAGE_INTENTS } from "../db/schema";

// What a worker's message on the shifts line asks for, by keyword (docs/messaging-templates.md,
// "Instant replies on the shifts line"): whole words, any case, in this order, so "can I cancel my
// shift" is a cancel and "help" (the least specific) comes last. Nothing matched: null (the AI
// may pick, or the office gets it). Pure.
//
// A keyword skips the AI and the office, so a wrong match costs more than a miss (a miss goes to
// the office, the safe side). So the open shifts keywords only count in a message with no dropout
// words: "can't make my shift", "not available Saturday" and "late for work" are about their own
// shift, not looking for one, and go to the AI or the office. ("shift" itself isn't a keyword:
// most messages with it are about their own shift.)

export type Intent = (typeof MESSAGE_INTENTS)[number];

const RULES: readonly [Intent, readonly string[]][] = [
  ["cancel", ["cancel", "cancelling", "canceling", "cancellation"]],
  ["pay", ["pay", "paid", "wages", "payslip", "payslips"]],
  ["shifts", ["shifts", "work", "available"]],
  ["office", ["help", "office", "talk"]],
];

// Words (apostrophes dropped: "can't" is "cant") that mean they can't make, or are late for, a shift.
const DROPOUT = new Set(["cant", "cannot", "wont", "not", "unable", "sick", "ill", "late"]);

export function keywordIntent(text: string): Intent | null {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/['’]/g, "")
      .match(/[a-z]+/g) ?? [],
  );
  const dropout = [...words].some((w) => DROPOUT.has(w));
  for (const [intent, keys] of RULES) {
    if (intent === "shifts" && dropout) continue;
    if (keys.some((k) => words.has(k))) return intent;
  }
  return null;
}
