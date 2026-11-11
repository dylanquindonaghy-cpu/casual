import { asc, eq, sql } from "drizzle-orm";
import { answers, firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { autoRepliesOn } from "../inbound/limits";
import { libraryAllowed } from "../inbound/keywords";
import { factsFor, type FactsContext } from "./facts";
import { fillInsNeeded, isFillInKey } from "./fill-ins";
import { aboutPayTrouble, matchByExample } from "./match";
import { answerText, type AnswerTopic, type Facts } from "./render";
import { answersOn, type AnswerChannel } from "./switches";
import { examplesFromText } from "./validate";

// The answer library as the reply jobs use it (Phase 35.2; docs/screens.md "## Phase 35", "The
// match"): the firm's switched-on answers, for a channel whose switch is on and a message that isn't
// about pay going wrong; the match by example; and an answer filled in for the casual. The jobs
// themselves (src/lib/inbound/reply.ts, src/lib/email/sort.ts) decide the order: STOP and START,
// then (unless it asks to cancel or for a person, or is a dropout) an example match, then the
// built-in keywords, then the AI shown these answers too; and, inside the claim, the answer and its
// channel re-read (recheckAnswer()) and the words filled in from the answer as it is then.

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
// text, when it's about pay going wrong (golden rule 9: then the built-in path, as before), or when
// it asks to cancel or for a person, or says they can't make it or are late (libraryAllowed(): the
// guardrails review, H1; then the built-in keywords, the AI's four labels or the office). None:
// neither the example match nor the AI's answer labels.
export async function answersFor(
  tx: FirmTx,
  settings: Record<string, unknown>,
  channel: AnswerChannel,
  text: string | null,
): Promise<LibraryAnswer[]> {
  if (!answersOn(settings, channel) || !text?.trim() || aboutPayTrouble(text)) return [];
  if (!libraryAllowed(text)) return [];
  return switchedOnAnswers(tx);
}

export { matchByExample };

// The answer and its channel as they are now, re-read inside the claim (the guardrails review, M2):
// an admin may have switched the answer off, edited its words, or switched the channel (or, for
// texts and email, the owner's `auto_replies`) off since the job first read them. On: the words to
// fill in, as they are now. Off: nothing goes, and the message is the office's
// (`answerSwitchedOff` in its log).
export type Rechecked = { on: true; body: string; topic: AnswerTopic } | { on: false };

export async function recheckAnswer(
  tx: FirmTx,
  answerId: string,
  channel: AnswerChannel,
): Promise<Rechecked> {
  const [row] = await tx
    .select({
      isOn: answers.isOn,
      body: answers.body,
      name: answers.name,
      examples: answers.examples,
    })
    .from(answers)
    .where(eq(answers.id, answerId));
  const [firm] = await tx
    .select({ settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const settings = firm?.settings ?? {};
  const channelOn = answersOn(settings, channel) && (channel === "app" || autoRepliesOn(settings));
  return row?.isOn && channelOn
    ? {
        on: true,
        body: row.body,
        topic: { name: row.name, examples: examplesFromText(row.examples) },
      }
    : { on: false };
}

// The casual's facts an answer's words need (src/lib/answers/facts.ts), read before the claim.
export async function answerFacts(
  tx: FirmTx,
  ctx: FactsContext,
  workerId: string,
  body: string,
): Promise<Facts> {
  return factsFor(tx, ctx, workerId, fillInsNeeded(body));
}

export type Prepared = { ok: true; text: string } | { ok: false; missing: string[] };

// The answer's words filled in for this casual (with the pay query hint where it goes:
// answerText()), or the fill-ins she has no value for (for the log: a key from the fixed list, or
// "unknown"). Words re-read in the claim that need a fill-in not read before: missing too.
export function wordsFor(body: string, facts: Facts, topic?: AnswerTopic): Prepared {
  const rendered = answerText(body, facts, topic);
  if ("text" in rendered) return { ok: true, text: rendered.text };
  return {
    ok: false,
    missing: [...new Set(rendered.missing.map((k) => (isFillInKey(k) ? k : "unknown")))],
  };
}
