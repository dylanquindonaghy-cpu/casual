import { ANSWER_PAY_HINT } from "../messaging/pay-hint";
import { keywordWords } from "../inbound/keywords";
import { FILL_INS, isFillInKey, tokensIn, type FillInKey } from "./fill-ins";

// An answer's words with its fill-ins done (Phase 35): each {key} replaced by the casual's own fact
// (src/lib/answers/facts.ts). Any fill-in with no value for them (no next shift, no licence with a
// date), or a {word} that isn't a fill-in at all: nothing is sent, and the office gets the question
// (`missing` lists which, for the log). Pure.

export type Facts = Partial<Record<FillInKey, string | null>>;

export type Rendered = { text: string } | { missing: string[] };

export function renderAnswer(body: string, facts: Facts): Rendered {
  const missing: string[] = [];
  for (const token of tokensIn(body)) {
    const value = isFillInKey(token) ? facts[token] : undefined;
    if (
      (value === undefined || value === null || value.trim() === "") &&
      !missing.includes(token)
    ) {
      missing.push(token);
    }
  }
  if (missing.length > 0) return { missing };
  const text = body
    .replace(/\{([A-Za-z0-9_]+)\}/g, (_all, key: string) =>
      isFillInKey(key) ? (facts[key] ?? "").trim() : "",
    )
    .replace(/[ \t]+/g, " ")
    .trim();
  return { text };
}

// The fill-ins that tell a casual about her pay: an answer using any gets the pay query hint.
export const PAY_FILL_INS: readonly FillInKey[] = ["next_pay_day", "pay_cycle", "pay_link"];
export const usesPayFillIn = (body: string): boolean =>
  tokensIn(body).some((t) => (PAY_FILL_INS as readonly string[]).includes(t));

// The words as they go (golden rule 9; the guardrails review, M1): filled in, then, for an answer
// whose words use a pay fill-in, or whose name or examples are about pay, "If your pay looks wrong, tap 'Raise a pay query'…" after them, so
// a casual whose pay day answer isn't what she expected knows the way to payroll. Added by code, on
// every channel; the office's preview shows it too.
// An answer about pay by its topic, not its words (the second guardrails review, L): its name or an
// example holds a pay keyword ("We pay every Friday", asked as "when do we get paid").
const PAY_TOPIC = new Set(["pay", "paid", "wages", "payslip", "payslips", "payday"]);
export interface AnswerTopic {
  name: string;
  examples: readonly string[];
}
export const aboutPayTopic = (topic: AnswerTopic | undefined): boolean =>
  !!topic &&
  [topic.name, ...topic.examples].some((t) => [...keywordWords(t)].some((w) => PAY_TOPIC.has(w)));

export function answerText(body: string, facts: Facts, topic?: AnswerTopic): Rendered {
  const rendered = renderAnswer(body, facts);
  if (!("text" in rendered) || !(usesPayFillIn(body) || aboutPayTopic(topic))) return rendered;
  return { text: `${rendered.text} ${ANSWER_PAY_HINT}` };
}

// What a casual would get, for the office's preview (35.3): the words filled in with each fill-in's
// made-up example (src/lib/answers/fill-ins.ts), never anyone's real facts, with the pay query hint
// where it goes.
export function previewAnswer(body: string, topic?: AnswerTopic): Rendered {
  return answerText(
    body,
    Object.fromEntries(FILL_INS.map((f) => [f.key, f.example])) as Facts,
    topic,
  );
}
