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

// What a casual would get, for the office's preview (35.3): the words filled in with each fill-in's
// made-up example (src/lib/answers/fill-ins.ts), never anyone's real facts.
export function previewAnswer(body: string): Rendered {
  return renderAnswer(body, Object.fromEntries(FILL_INS.map((f) => [f.key, f.example])) as Facts);
}
