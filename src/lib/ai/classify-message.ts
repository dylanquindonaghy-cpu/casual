import { MESSAGE_INTENTS } from "../db/schema/messages";
import type { Intent } from "../inbound/keywords";
import { AI_TIMEOUT_MS, askAi } from "./ask";
import type { AiClient } from "./client";

// Sorting a worker's message on the shifts line when no keyword matched (docs/messaging-templates.md
// "Instant replies": "anything else → Haiku classifies"). The AI sees the worker's text only and
// must answer exactly one label; anything else, no answer in time, or no AI: null, and the office
// gets the message. The label only picks which of the app's fixed replies goes back: nothing the
// AI writes reaches the worker (golden rules 1 and 9: a pay question gets the pay link, never an
// answer).

const SYSTEM =
  "You sort a message a casual worker sent to their staffing firm's shifts line. Answer with one " +
  "word only, from: shifts (wants work or to see open shifts), cancel (wants to cancel a shift), " +
  "pay (asks about pay, hours or payslips), office (anything else, or wants a person).";

export async function classifyMessage(
  text: string,
  ai: AiClient,
  opts: { timeoutMs?: number } = {},
): Promise<Intent | null> {
  const raw = await askAi(
    ai,
    { purpose: "classify_message", system: SYSTEM, prompt: text.slice(0, 1600), maxTokens: 5 },
    opts.timeoutMs ?? AI_TIMEOUT_MS,
  );
  if (typeof raw !== "string") return null;
  const label = raw.trim().toLowerCase().replace(/[.!]$/, "");
  return (MESSAGE_INTENTS as readonly string[]).includes(label) ? (label as Intent) : null;
}
