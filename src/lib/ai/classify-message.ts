import { MESSAGE_INTENTS } from "../db/schema/messages";
import type { Intent } from "../inbound/keywords";
import { AI_TIMEOUT_MS, askAi } from "./ask";
import type { AiClient } from "./client";
import { cutChars } from "../text/cut";

// Sorting a worker's message on the shifts line when no keyword matched (docs/messaging-templates.md
// "Instant replies": "anything else → Haiku classifies"). The AI sees the worker's text only and
// must answer exactly one label; anything else, no answer in time, or no AI: null, and the office
// gets the message. The label only picks which of the app's fixed replies goes back: nothing the
// AI writes reaches the worker (golden rules 1 and 9: a pay question gets the pay link, never an
// answer).

// The same four labels for an email to the firm's staffing inbox (P7.4), told it's an email.
const LABELS =
  "Answer with one word only, from: shifts (wants work or to see open shifts), cancel (wants to " +
  "cancel a shift), pay (asks about pay, hours or payslips), office (anything else, or wants a " +
  "person).";
const SYSTEM = {
  shifts_line: `You sort a message a casual worker sent to their staffing firm's shifts line. ${LABELS}`,
  email: `You sort an email a casual worker sent to their staffing firm (its subject, then its words). ${LABELS}`,
  app: `You sort a message a casual worker sent to their staffing firm in its app. ${LABELS}`,
};

export async function classifyMessage(
  text: string,
  ai: AiClient,
  opts: { timeoutMs?: number } = {},
): Promise<Intent | null> {
  return (await sortMessage(text, ai, opts)).label;
}

// Why the AI didn't sort a message, for the office's "How it was answered" (12D.2): no AI connected,
// no answer in time (or it failed), or an answer that isn't one of the labels.
export type AiFallback = "not_connected" | "no_answer" | "not_a_label";

// The four built-in labels the AI may answer ("answer" is never one: only a1..aN below picks one).
const BUILT_IN: readonly string[] = MESSAGE_INTENTS.filter((i) => i !== "answer");

type Via = "shifts_line" | "email" | "app";

export async function sortMessage(
  text: string,
  ai: AiClient,
  opts: { timeoutMs?: number; via?: Via } = {},
): Promise<{ label: Intent } | { label: null; why: AiFallback }> {
  const sorted = await sortMessageOrAnswer(text, ai, { ...opts, answers: [] });
  return sorted.label === null ? sorted : { label: sorted.label };
}

// The answer library (Phase 35; docs/screens.md "## Phase 35", "The match"): the same sorting, also
// shown the firm's switched-on answers by name and example questions (the office's own words: never
// a fill-in's value, nor anything about the casual), each as a label a1, a2, ... The AI picks one
// label or none: `answer` is the index (0-based) of the answer it picked, and the label "answer";
// otherwise a built-in label, as sortMessage(). It never writes a word the casual sees: code fills
// in the answer it picked (src/lib/answers/). With no answers given, exactly sortMessage().
export const MAX_OFFERED_ANSWERS = 30;

export async function sortMessageOrAnswer(
  text: string,
  ai: AiClient,
  opts: {
    timeoutMs?: number;
    via?: Via;
    answers: readonly { name: string; examples: readonly string[] }[];
  },
): Promise<{ label: Intent; answer: number | null } | { label: null; why: AiFallback }> {
  if (ai.name === "none") return { label: null, why: "not_connected" };
  const offered = opts.answers.slice(0, MAX_OFFERED_ANSWERS);
  const system =
    offered.length === 0
      ? SYSTEM[opts.via ?? "shifts_line"]
      : `${SYSTEM[opts.via ?? "shifts_line"]} Or, only if the message asks exactly what one of the firm's own answers below is for, answer that answer's label instead (one word, such as a1). The firm's answers: ${offered
          .map(
            (a, i) =>
              `a${i + 1} (${cutChars(a.name, 60)}${a.examples.length > 0 ? `: ${a.examples.map((e) => cutChars(e, 100)).join("; ")}` : ""})`,
          )
          .join(", ")}.`;
  const raw = await askAi(
    ai,
    {
      purpose: "classify_message",
      system,
      prompt: cutChars(text, 1600),
      maxTokens: 5,
    },
    opts.timeoutMs ?? AI_TIMEOUT_MS,
  );
  if (typeof raw !== "string") return { label: null, why: "no_answer" };
  const label = raw.trim().toLowerCase().replace(/[.!]$/, "");
  if (BUILT_IN.includes(label)) return { label: label as Intent, answer: null };
  const picked = /^a([1-9][0-9]?)$/.exec(label);
  const index = picked ? Number(picked[1]) - 1 : -1;
  return index >= 0 && index < offered.length
    ? { label: "answer", answer: index }
    : { label: null, why: "not_a_label" };
}
