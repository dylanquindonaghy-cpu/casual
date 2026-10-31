// The AI connection (docs/architecture.md "Where AI is used": Claude through the Anthropic API;
// Haiku for sorting and summaries). AI only reads, classifies, drafts and summarises; code decides
// everything else (golden rule 1), and every answer is checked before use.
//
// The Anthropic client (src/lib/ai/anthropic.ts) is behind this interface, off until
// AI_TRANSPORT=anthropic ("Connect the Anthropic API", PLAN.md Parking lot). Until then `noAi`
// answers every request with "unavailable" and callers use their code fallback; tests use a fake.

// Everything the AI may be asked to do: a summary line for payroll; sorting a worker's message on
// the shifts line, or their email to the staffing inbox, into one of four labels (an automatic reply
// is always the app's own fixed text); and (P7.5) a draft of the office's reply to a casual's email,
// which a person checks and changes before they send it. Nothing a worker reads is written by AI
// without a person choosing to send it, and no AI answers or drafts about pay (golden rule 9;
// tests/unit/ai.boundary.test.ts holds this list and who may import this module).
export const AI_PURPOSES = ["pay_group_summary", "classify_message", "draft_reply"] as const;

export interface AiRequest {
  purpose: (typeof AI_PURPOSES)[number]; // what the call is for (for logging and limits)
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface AiClient {
  readonly name: string;
  // The model's text, or throws AiUnavailableError (not connected, timed out, refused).
  complete(request: AiRequest): Promise<string>;
}

export class AiUnavailableError extends Error {
  constructor(reason: string) {
    super(`AI unavailable: ${reason}`);
    this.name = "AiUnavailableError";
  }
}

export const noAi: AiClient = {
  name: "none",
  complete: async () => {
    throw new AiUnavailableError("not connected");
  },
};

// Tests: answers with `respond(request)` (which may throw to act out a failure).
export function createFakeAi(respond: (request: AiRequest) => string | Promise<string>): AiClient {
  return { name: "fake", complete: async (request) => respond(request) };
}
