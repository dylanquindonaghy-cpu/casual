// The AI connection (docs/architecture.md "AI use": Claude on Amazon Bedrock, EU inference
// profile; Haiku for sorting and summaries). AI only reads, classifies, drafts and summarises; code
// decides everything else (golden rule 1), and every answer is checked before use.
//
// Not connected yet: Bedrock is an outside service (PLAN.md Parking lot, "Connect Bedrock"). Until
// then `noAi` answers every request with "unavailable" and callers use their code fallback; tests
// use a fake. The Bedrock client is added behind this same interface.

export interface AiRequest {
  purpose: "pay_group_summary"; // what the call is for (for logging and limits)
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
