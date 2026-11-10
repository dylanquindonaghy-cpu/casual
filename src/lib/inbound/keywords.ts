import type { MESSAGE_INTENTS } from "../db/schema";

// What a worker's message on the shifts line asks for, by keyword (docs/messaging-templates.md,
// "Instant replies on the shifts line"): whole words, any case, in this order, so "can I cancel my
// shift" is a cancel and "help" (the least specific) comes last. Nothing matched: null (the AI
// may pick, or the office gets it). Pure.
//
// Asking for a person by name ("office", "talk") comes first (Phase 35, the guardrails review of
// the answer library, H1): every automatic reply says "Send OFFICE to reach a person", so a message
// with that word always reaches one, whatever else it says ("office, when do we get paid" is the
// office's, not the pay link's). A miss sends a message to a person, the safe side.
//
// A keyword skips the AI and the office, so a wrong match costs more than a miss (a miss goes to
// the office, the safe side). So the open shifts keywords only count in a message with no dropout
// words: "can't make my shift", "not available Saturday" and "late for work" are about their own
// shift, not looking for one, and go to the AI or the office. ("shift" itself isn't a keyword:
// most messages with it are about their own shift.)

export type Intent = (typeof MESSAGE_INTENTS)[number];

// The built-in keywords' words, by what they ask for.
export const PERSON_WORDS = ["office", "talk"] as const; // a person, by name
export const CANCEL_WORDS = ["cancel", "cancelling", "canceling", "cancellation"] as const;
export const HELP_WORDS = ["help"] as const; // a person too, but the least specific: last

const RULES: readonly [Intent, readonly string[]][] = [
  ["office", PERSON_WORDS],
  ["cancel", CANCEL_WORDS],
  ["pay", ["pay", "paid", "wages", "payslip", "payslips"]],
  ["shifts", ["shifts", "work", "available"]],
  ["office", HELP_WORDS],
];

// Words (apostrophes dropped: "can't" is "cant") that mean they can't make, or are late for, a shift.
export const DROPOUT_WORDS = [
  "cant",
  "cannot",
  "wont",
  "not",
  "unable",
  "sick",
  "ill",
  "late",
] as const;
const DROPOUT = new Set<string>(DROPOUT_WORDS);

// A message's words as the keywords read them: lower case, apostrophes dropped, letters only.
export function keywordWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/['’`]/g, "")
      .match(/[a-z]+/g) ?? [],
  );
}

export function keywordIntent(text: string): Intent | null {
  const words = keywordWords(text);
  const dropout = [...words].some((w) => DROPOUT.has(w));
  for (const [intent, keys] of RULES) {
    if (intent === "shifts" && dropout) continue;
    if (keys.some((k) => words.has(k))) return intent;
  }
  return null;
}

// The words that keep a message from the firm's answer library (Phase 35; docs/screens.md
// "## Phase 35", "The match"): asking to cancel, asking for a person (office, talk, help), or saying
// they can't make it or are late (the dropout words). Such a message never gets a library answer,
// by an example question or by the AI: it goes on to the built-in keywords, the AI's four labels or
// the office, as before Phase 35. So "sick, can't make tonight, is anyone in?" reaches a person, not
// Office hours. STOP and START are handled before any of this.
// Words that say something has gone wrong with a shift without the dropout words ("I'm poorly",
// "family emergency", "stuck in traffic"): they keep a message from the library too (the second
// guardrails review, M1), though not from the shifts keyword. Wide on purpose: a word too many only
// means the office answers.
export const LIBRARY_STOP_WORDS = [
  "unwell",
  "poorly",
  "emergency",
  "hospital",
  "ambulance",
  "injured",
  "injury",
  "accident",
  "funeral",
  "bereavement",
  "delayed",
  "delay",
  "traffic",
  "stuck",
  "breakdown",
  "broken",
  "broke",
  "missed",
  "covid",
  "drop",
  "dropout",
  "swap",
  "quit",
  // The third review: a shift or a train "cancelled", and more ways of saying they can't make it.
  "cancelled",
  "canceled",
  "behind",
  "hurt",
  "flu",
  "doctor",
  "doctors",
  "dentist",
  "puncture",
  "tyre",
  "tire",
  "childcare",
  "vomiting",
] as const;
const NO_LIBRARY = new Set<string>([
  ...PERSON_WORDS,
  ...CANCEL_WORDS,
  ...HELP_WORDS,
  ...DROPOUT,
  ...LIBRARY_STOP_WORDS,
]);

export function libraryAllowed(text: string): boolean {
  for (const w of keywordWords(text)) if (NO_LIBRARY.has(w)) return false;
  return true;
}

// The words an answer's example question may not hold (src/lib/answers/validate.ts): the ones
// above, which keep a message from the library anyway (so an example with one could never match),
// and STOP and START (a text of only those turns texts off or on). Whole words, as above.
export const RESERVED_EXAMPLE_WORDS: readonly string[] = [...NO_LIBRARY, "stop", "start"];
const RESERVED = new Set(RESERVED_EXAMPLE_WORDS);

export function reservedWordIn(text: string): string | null {
  for (const w of keywordWords(text)) if (RESERVED.has(w)) return w;
  return null;
}
