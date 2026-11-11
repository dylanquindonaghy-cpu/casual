import { z } from "zod";
import {
  ANSWER_TEXT_PARTS_AT,
  ANSWER_BODY_MAX,
  ANSWER_EXAMPLE_MAX,
  ANSWER_EXAMPLES_MAX,
  ANSWER_NAME_MAX,
} from "./limits";
import { isFillInKey, tokensIn } from "./fill-ins";
import { reservedWordIn } from "../inbound/keywords";
import { holdsPhoneOrEmail } from "../log/mask";

// An answer as the office sends it (Phase 35; the Add and Edit form in 35.3), checked at the
// boundary: a name of 1 to 60 characters; example phrases one a line (blank lines dropped, each
// trimmed, at most 10 of at most 100 characters); words of 1 to 600 characters whose every {word}
// is one of the fixed fill-ins (src/lib/answers/fill-ins.ts). Spaces at either end are trimmed.
// No example may hold a word that always reaches a person or a built-in reply (cancel, office, help,
// talk, the dropout words such as "can't", "not", "sick" or "late", STOP and START:
// src/lib/inbound/keywords.ts): a message with one never gets a library answer, so the example could
// never match (the guardrails review, H1). No name or example may hold a phone number or an email
// address, found as the log's masker finds them (holdsPhoneOrEmail(), src/lib/log/mask.ts):
// "Make this an answer" starts an example from a casual's own words, and the names and examples go
// to the AI and on the office's pages (L2). The messages are the office's words (docs/screens.md
// "## Phase 35").

export const ANSWER_ERRORS = {
  nameMissing: "Give the answer a name.",
  nameLong: `Keep the name to ${ANSWER_NAME_MAX} characters.`,
  examplesMany: `Up to ${ANSWER_EXAMPLES_MAX} example questions.`,
  exampleLong: `Keep each example question to ${ANSWER_EXAMPLE_MAX} characters.`,
  bodyMissing: "Write the answer.",
  bodyLong: `Keep the answer to ${ANSWER_BODY_MAX} characters.`,
  unknownFillIn: "Use only the fill-ins from the list.",
  exampleReserved:
    "Leave out cancel, office, help, talk, stop, start, and words like can't, not, sick or late: messages with them always go to a person or a built-in reply.",
  nameContact: "Take out the phone number or email address.",
  exampleContact: "Take out the phone number or email address.",
} as const;

// Soft notes on the form (not a block; docs/screens.md "## Phase 35", "Add and Edit"): words long
// enough that a text goes in several parts (L1), and words that look signed by a person (golden
// rule 8: every reply is signed by the firm's Shift Team; L3).
export const ANSWER_NOTES = {
  longText: `Over ${ANSWER_TEXT_PARTS_AT} characters: a text sends it in several parts.`,
  personSignOff: "Replies are signed by the firm's Shift Team: don't add a person's name.",
} as const;

// A line that reads as a person's sign-off: "Thanks, Sam", "Cheers Sam", "Many thanks," with "Sam"
// on the next line, "Kind regards" (with or without a name), or a last line "— Sam" / "- Sam Rota".
// A fill-in ("Thanks, {first_name}": the casual's own name) or a sentence ("Thanks for asking")
// isn't one. Pure; a warning only, never a block.
const THANKS =
  /^(?:thanks|thank you|many thanks|cheers|best wishes|all the best|best)\b[ \t]*[,!.]?[ \t]*(.*)$/i;
const REGARDS = /^(?:kind |best |warm )?regards\b/i;
const A_NAME = /^[A-Z][a-z]+(?: [A-Z][a-z]+)?[.!]?$/;
const DASH_NAME = /^[—–-]{1,2}[ \t]*[A-Z][a-z]+(?: [A-Z][a-z]+)?$/;
// The same at the end of a sentence on one line: "Park at gate C. Cheers, Sam".
const ENDS_THANKS =
  /[.!?][ \t]+(?:[Tt]hanks|[Tt]hank you|[Mm]any thanks|[Cc]heers|[Bb]est wishes|[Aa]ll the best|[Bb]est|(?:[Kk]ind |[Bb]est |[Ww]arm )?[Rr]egards)[ \t]*[,!.]?[ \t]+[A-Z][a-z]+(?: [A-Z][a-z]+)?[.!]?$/;
export function looksSignedByPerson(body: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const [i, line] of lines.entries()) {
    if (REGARDS.test(line)) return true;
    const thanks = THANKS.exec(line);
    if (thanks) {
      const rest = (thanks[1] ?? "").trim();
      if (A_NAME.test(rest)) return true;
      if (rest === "" && A_NAME.test(lines[i + 1] ?? "")) return true;
    }
  }
  const last = lines.at(-1) ?? "";
  return DASH_NAME.test(last) || ENDS_THANKS.test(last);
}

// The example phrases as stored: one a line, trimmed, no blank lines.
export const examplesFromText = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

const nameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, ANSWER_ERRORS.nameMissing)
      .max(ANSWER_NAME_MAX, ANSWER_ERRORS.nameLong)
      .refine((s) => !holdsPhoneOrEmail(s), ANSWER_ERRORS.nameContact),
  );

const examplesSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? examplesFromText(v.join("\n")) : examplesFromText(v)))
  .pipe(
    z
      .array(
        z
          .string()
          .max(ANSWER_EXAMPLE_MAX, ANSWER_ERRORS.exampleLong)
          .refine((s) => reservedWordIn(s) === null, ANSWER_ERRORS.exampleReserved)
          .refine((s) => !holdsPhoneOrEmail(s), ANSWER_ERRORS.exampleContact),
      )
      .max(ANSWER_EXAMPLES_MAX, ANSWER_ERRORS.examplesMany),
  );

const bodySchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, ANSWER_ERRORS.bodyMissing)
      .max(ANSWER_BODY_MAX, ANSWER_ERRORS.bodyLong)
      .refine((s) => tokensIn(s).every(isFillInKey), ANSWER_ERRORS.unknownFillIn),
  );

export const answerInputSchema = z.object({
  name: nameSchema,
  examples: examplesSchema,
  body: bodySchema,
});
export type AnswerInput = z.input<typeof answerInputSchema>;
export type ValidAnswer = z.output<typeof answerInputSchema>;

export type AnswerCheck =
  | { ok: true; answer: ValidAnswer }
  | { ok: false; errors: Partial<Record<"name" | "examples" | "body", string>> };

// The answer checked, or the first problem with each field (the form shows it under the field).
export function checkAnswer(input: unknown): AnswerCheck {
  const parsed = answerInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, answer: parsed.data };
  const errors: Partial<Record<"name" | "examples" | "body", string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "examples" || field === "body") && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  if (Object.keys(errors).length === 0) errors.body = ANSWER_ERRORS.bodyMissing;
  return { ok: false, errors };
}
