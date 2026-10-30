import { askAi } from "./ask";
import type { AiClient } from "./client";
import { cutChars } from "../text/cut";

// The AI's draft of the office's reply to a casual's email to the staffing inbox (P7.5;
// docs/messaging-templates.md "The staffing inbox's emails"). It sees the email's subject and words
// only: none of the firm's data, so it can't state a fact or promise anything (golden rule 1). The
// draft is only ever shown to the office on Enquiries, to check and change before a person sends it;
// nothing goes to the casual from here. The caller decides whether there's one at all (never about
// pay: golden rule 9, src/lib/email/sort.ts). Anything that isn't a usable draft: null, and the
// office writes their own.

const SYSTEM =
  "You draft a reply for a staffing firm's office to send to one of its casual workers, who " +
  "emailed them. Write only the reply's body, in plain words and short sentences, polite and " +
  "warm. No greeting and no sign-off: they are added. Never promise or offer anything (no " +
  "shift, time, pay, money or decision), never state a fact you weren't given, and never " +
  "mention pay or money. Where they ask for something only the office can decide, say the " +
  "office will look into it and get back to them. At most 100 words. Answer with the reply only.";

export const DRAFT_MAX = 1200; // inbound_emails_draft_reply_length
const DRAFT_TIMEOUT_MS = 15_000;

// A greeting the model added anyway ("Hi Priya,"), and a sign-off ("Best wishes, …").
const GREETING = /^\s*(hi|hello|dear|hey)\b[^\n]*\n+/i;
const SIGN_OFF = /\n+\s*(best|kind|warm)?\s*(regards|wishes|thanks)[^\n]*(\n[^\n]*)?\s*$/i;

export async function draftEmailReply(
  email: { subject: string | null; body: string | null },
  ai: AiClient,
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  if (ai.name === "none") return null;
  const prompt = [
    email.subject ? `Subject: ${email.subject}` : null,
    email.body ? email.body : null,
  ]
    .filter((x): x is string => x !== null)
    .join("\n\n");
  if (!prompt.trim()) return null;
  const raw = await askAi(
    ai,
    { purpose: "draft_reply", system: SYSTEM, prompt: cutChars(prompt, 4000), maxTokens: 400 },
    opts.timeoutMs ?? DRAFT_TIMEOUT_MS,
  );
  if (typeof raw !== "string") return null;
  const draft = raw.replace(GREETING, "").replace(SIGN_OFF, "").trim();
  if (draft.length === 0 || [...draft].length > DRAFT_MAX) return null;
  return draft;
}
