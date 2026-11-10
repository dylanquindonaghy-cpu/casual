import { z } from "zod";
import {
  ANSWER_BODY_MAX,
  ANSWER_EXAMPLE_MAX,
  ANSWER_EXAMPLES_MAX,
  ANSWER_NAME_MAX,
} from "./limits";
import { isFillInKey, tokensIn } from "./fill-ins";

// An answer as the office sends it (Phase 35; the Add and Edit form in 35.3), checked at the
// boundary: a name of 1 to 60 characters; example phrases one a line (blank lines dropped, each
// trimmed, at most 10 of at most 100 characters); words of 1 to 600 characters whose every {word}
// is one of the fixed fill-ins (src/lib/answers/fill-ins.ts). Spaces at either end are trimmed.
// The messages are the office's words (docs/screens.md "## Phase 35").

export const ANSWER_ERRORS = {
  nameMissing: "Give the answer a name.",
  nameLong: `Keep the name to ${ANSWER_NAME_MAX} characters.`,
  examplesMany: `Up to ${ANSWER_EXAMPLES_MAX} example questions.`,
  exampleLong: `Keep each example question to ${ANSWER_EXAMPLE_MAX} characters.`,
  bodyMissing: "Write the answer.",
  bodyLong: `Keep the answer to ${ANSWER_BODY_MAX} characters.`,
  unknownFillIn: "Use only the fill-ins from the list.",
} as const;

// The example phrases as stored: one a line, trimmed, no blank lines.
export const examplesFromText = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

const nameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, ANSWER_ERRORS.nameMissing).max(ANSWER_NAME_MAX, ANSWER_ERRORS.nameLong));

const examplesSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? examplesFromText(v.join("\n")) : examplesFromText(v)))
  .pipe(
    z
      .array(z.string().max(ANSWER_EXAMPLE_MAX, ANSWER_ERRORS.exampleLong))
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
