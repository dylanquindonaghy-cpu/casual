import { and, asc, eq } from "drizzle-orm";
import { answers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { factsFor, type FactsContext } from "./facts";
import { fillInsNeeded, isFillInKey } from "./fill-ins";
import { aboutPayTrouble, matchByExample } from "./match";
import { renderAnswer } from "./render";
import { answersOn, type AnswerChannel } from "./switches";
import { examplesFromText } from "./validate";

// The answer library as the reply jobs use it (Phase 35.2; docs/screens.md "## Phase 35", "The
// match"): the firm's switched-on answers, for a channel whose switch is on and a message that isn't
// about pay going wrong; the match by example; and an answer filled in for the casual. The jobs
// themselves (src/lib/inbound/reply.ts, src/lib/email/sort.ts) decide the order: STOP and START,
// then an example match, then the built-in keywords, then the AI shown these answers too.

export interface LibraryAnswer {
  id: string;
  name: string;
  examples: string[];
  body: string;
}

// The firm's switched-on answers, oldest first (the AI's labels a1.. follow this order).
export async function switchedOnAnswers(tx: FirmTx): Promise<LibraryAnswer[]> {
  const rows = await tx
    .select({ id: answers.id, name: answers.name, examples: answers.examples, body: answers.body })
    .from(answers)
    .where(eq(answers.isOn, true))
    .orderBy(asc(answers.createdAt), asc(answers.id));
  return rows.map((r) => ({ ...r, examples: examplesFromText(r.examples) }));
}

// The answers a message may get on a channel: none when the channel's switch is off, when there's no
// text, or when it's about pay going wrong (golden rule 9: then the built-in path, as before).
export async function answersFor(
  tx: FirmTx,
  settings: Record<string, unknown>,
  channel: AnswerChannel,
  text: string | null,
): Promise<LibraryAnswer[]> {
  if (!answersOn(settings, channel) || !text?.trim() || aboutPayTrouble(text)) return [];
  return switchedOnAnswers(tx);
}

export { matchByExample };

// One answer still switched on, as the claim re-reads it (an admin may switch it off meanwhile).
export async function stillOn(tx: FirmTx, answerId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: answers.id })
    .from(answers)
    .where(and(eq(answers.id, answerId), eq(answers.isOn, true)));
  return row !== undefined;
}

export type Prepared = { ok: true; text: string } | { ok: false; missing: string[] };

// The answer's words filled in for this casual, or the fill-ins she has no value for (for the log:
// a key from the fixed list, or "unknown").
export async function prepareAnswer(
  tx: FirmTx,
  ctx: FactsContext,
  workerId: string,
  answer: Pick<LibraryAnswer, "body">,
): Promise<Prepared> {
  const facts = await factsFor(tx, ctx, workerId, fillInsNeeded(answer.body));
  const rendered = renderAnswer(answer.body, facts);
  if ("text" in rendered) return { ok: true, text: rendered.text };
  return {
    ok: false,
    missing: [...new Set(rendered.missing.map((k) => (isFillInKey(k) ? k : "unknown")))],
  };
}
