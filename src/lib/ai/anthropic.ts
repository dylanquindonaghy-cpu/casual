import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { WorkerEnv } from "../env";
import { log, type Logger } from "../log";
import { AI_TIMEOUT_MS } from "./ask";
import { AiUnavailableError, noAi, type AiClient, type AiRequest } from "./client";

// Claude through the Anthropic API (docs/office-v2.md 5.8; ADR-021), with AI_TRANSPORT=anthropic,
// worker only. It answers the two AI_PURPOSES and nothing else; every answer is still checked by
// its caller, and any failure means the code's fallback (golden rule 1). Real calls wait for
// "Connect the Anthropic API" (PLAN.md Parking lot); tests never reach it (the settings refuse
// anthropic under NODE_ENV=test, and this client needs a test's fake fetch there).

// Under load (P4.6; PLAN.md "Ready for a big firm"), with one client per worker process (getAi keeps
// it, so these hold across every job):
// - at most AI_CALLS_AT_ONCE calls at once; the rest wait their turn, in order. One still waiting
//   when its 5 seconds are up is turned away ("busy") when its turn comes, without calling the
//   API: askAi gave up on it at 5 seconds, and the caller's fallback (the office) has run.
// - a breaker: after AI_BREAKER_FAILURES failed calls in a row (no answer in time, an HTTP error,
//   no connection; a refusal or an empty answer is the API working), every call fails at once
//   ("breaker_open") for AI_BREAKER_OPEN_MS; then one trial call goes: an answer closes it, a
//   failure opens it for as long again.
// No timers: the time is read from the clock as calls come and go. Still no retries.
export const AI_CALLS_AT_ONCE = 4;
export const AI_BREAKER_FAILURES = 5;
export const AI_BREAKER_OPEN_MS = 30_000;

// The API's own address, always: the SDK would otherwise take ANTHROPIC_BASE_URL from the
// environment, and send the key wherever it points.
export const ANTHROPIC_API_URL = "https://api.anthropic.com";
const MESSAGES_URL = `${ANTHROPIC_API_URL}/v1/messages`;

type Fetch = NonNullable<ClientOptions["fetch"]>;

// The only headers that go out: the SDK's own (as 0.131.0 sends them) and the key.
const SENT_HEADERS = new Set([
  "accept",
  "anthropic-version",
  "content-type",
  "user-agent",
  "x-api-key",
  "x-stainless-arch",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-retry-count",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
]);

// What reaches the wire, whatever the environment says: the Messages API's address only, those
// headers only, and the settings' key set last. The SDK always reads ANTHROPIC_CUSTOM_HEADERS and
// adds them after its login header, so without this a value there could replace the key or add a
// second login.
function pinnedFetch(apiKey: string, send: Fetch): Fetch {
  return async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== MESSAGES_URL) throw new Error("the Anthropic client only calls the Messages API");
    const headers = new Headers();
    new Headers(init.headers).forEach((value, name) => {
      if (SENT_HEADERS.has(name)) headers.set(name, value);
    });
    headers.set("x-api-key", apiKey);
    return send(url, { ...init, headers });
  };
}

export interface AnthropicConfig {
  apiKey: string; // ANTHROPIC_API_KEY, from the settings: never read from process.env here
  model: string; // AI_MODEL
}

// Only for tests: a fake fetch (no network), a shorter time limit, a logger to read, a clock (ms).
export interface AnthropicTestOverrides {
  fetch?: Fetch;
  timeoutMs?: number;
  logger?: Logger;
  now?: () => number;
}

// A call this client didn't make, and why, in fixed words.
class NotMade extends AiUnavailableError {
  constructor(readonly reason: "busy" | "breaker_open") {
    super(reason);
  }
}

interface Waiting {
  deadline: number;
  go: () => void;
  turnAway: (err: NotMade) => void;
}

export class AnthropicAiClient implements AiClient {
  readonly name = "anthropic";
  private readonly sdk: Anthropic;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly fakeFetch: boolean;
  private readonly now: () => number;
  // The calls going, and those waiting for a turn (oldest first).
  private running = 0;
  private readonly waiting: Waiting[] = [];
  // The breaker: failed calls in a row, open until (null: closed), and whether a trial is going.
  private failures = 0;
  private openUntil: number | null = null;
  private trialGoing = false;

  constructor(
    private readonly config: AnthropicConfig,
    overrides: AnthropicTestOverrides = {},
  ) {
    if (!config.apiKey) throw new Error("the Anthropic client needs ANTHROPIC_API_KEY");
    this.timeoutMs = overrides.timeoutMs ?? AI_TIMEOUT_MS;
    this.logger = overrides.logger ?? log.child({ ai: "anthropic" });
    this.fakeFetch = overrides.fetch !== undefined;
    this.now = overrides.now ?? Date.now;
    // The SDK's settings that would otherwise come from the environment are given here: the key,
    // no second login (ANTHROPIC_AUTH_TOKEN), the address, its own logging off (ANTHROPIC_LOG=debug
    // would print every prompt and answer), and pinnedFetch for the headers. No retries: a job
    // waits 5 seconds at most, once.
    const send: Fetch = overrides.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sdk = new Anthropic({
      apiKey: config.apiKey,
      authToken: null,
      baseURL: ANTHROPIC_API_URL,
      timeout: this.timeoutMs,
      maxRetries: 0,
      logLevel: "off",
      fetch: pinnedFetch(config.apiKey, send),
    });
  }

  async complete(request: AiRequest): Promise<string> {
    const { purpose } = request;
    const { model } = this.config;
    if (process.env.NODE_ENV === "test" && !this.fakeFetch) {
      throw new AiUnavailableError("tests never call the Anthropic API");
    }
    const asked = this.now();
    try {
      this.checkBreaker();
      await this.turn(asked + this.timeoutMs);
    } catch (err) {
      return this.notMade(err, purpose, model);
    }
    try {
      this.checkBreaker({ trial: true });
    } catch (err) {
      this.release();
      return this.notMade(err, purpose, model);
    }
    try {
      return await this.call(request);
    } finally {
      this.release();
    }
  }

  // The call itself (one of the calls at once, let through by the breaker).
  private async call(request: AiRequest): Promise<string> {
    const { purpose } = request;
    const { model } = this.config;
    let reply: { answer: string; refused: boolean; fields: Record<string, unknown> };
    try {
      const message = await this.sdk.messages.create(
        {
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
        },
        // The signal also stops a reply that is slow to arrive after its headers (the SDK's own
        // timeout ends at the headers).
        { signal: AbortSignal.timeout(this.timeoutMs), timeout: this.timeoutMs, maxRetries: 0 },
      );
      // Read here, so a reply without the expected shape is a failure like any other.
      reply = {
        answer: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        refused: message.stop_reason === "refusal",
        // The token counts go under `usage` (as the API names them): the logger hides any field
        // whose name has "token" in it (src/lib/log/mask.ts).
        fields: {
          purpose,
          model,
          usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
          stopReason: message.stop_reason ?? "none",
        },
      };
      this.answered();
    } catch (err) {
      this.failed();
      const reason = failureReason(err);
      // One line per call: what it was for, the model, and why it stopped. Never the prompt, the
      // answer, the key or the API's own words.
      this.logger.warn("AI call failed", { purpose, model, stopReason: reason });
      throw new AiUnavailableError(reason);
    }
    const { answer, refused, fields } = reply;
    if (refused || answer.trim() === "") {
      this.logger.warn("AI answer not used", fields);
      throw new AiUnavailableError(refused ? "refused" : "empty answer");
    }
    this.logger.info("AI answered", fields);
    return answer;
  }

  // A call not made (busy, or the breaker open): one line, like a failed call, then the error.
  private notMade(err: unknown, purpose: AiRequest["purpose"], model: string): never {
    const reason = err instanceof NotMade ? err.reason : "error";
    this.logger.warn("AI call not made", { purpose, model, stopReason: reason });
    throw err instanceof AiUnavailableError ? err : new AiUnavailableError(reason);
  }

  // Whether the breaker lets a call through now. Open: no. After its time, one trial: the call
  // that takes it (`trial`, once it has its turn) goes, and every other waits for the outcome.
  private checkBreaker(o: { trial?: boolean } = {}): void {
    if (this.openUntil === null) return;
    if (this.now() < this.openUntil || this.trialGoing) {
      throw new NotMade("breaker_open");
    }
    if (o.trial) this.trialGoing = true;
  }

  private answered(): void {
    if (this.openUntil !== null) {
      this.logger.info("AI breaker closed", { model: this.config.model });
    }
    this.failures = 0;
    this.openUntil = null;
    this.trialGoing = false;
  }

  private failed(): void {
    this.failures += 1;
    this.trialGoing = false;
    if (this.failures < AI_BREAKER_FAILURES) return;
    if (this.openUntil === null) {
      this.logger.warn("AI breaker open", { model: this.config.model, failures: this.failures });
    }
    this.openUntil = this.now() + AI_BREAKER_OPEN_MS;
  }

  // A turn among the calls at once: at once if one is free and nobody is waiting, otherwise in
  // order as calls finish.
  private turn(deadline: number): Promise<void> {
    if (this.running < AI_CALLS_AT_ONCE && this.waiting.length === 0) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((go, turnAway) => this.waiting.push({ deadline, go, turnAway }));
  }

  // A call has finished: its turn goes to the next waiting, or past one whose time is up (busy).
  private release(): void {
    this.running -= 1;
    while (this.running < AI_CALLS_AT_ONCE) {
      const next = this.waiting.shift();
      if (!next) return;
      if (this.now() > next.deadline) {
        next.turnAway(new NotMade("busy"));
        continue;
      }
      this.running += 1;
      next.go();
    }
  }
}

// Why a call failed, in fixed words: "timeout", "http_429", "connection" or "error".
function failureReason(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.APIUserAbortError) return "timeout"; // our signal: the time ran out
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return `http_${err.status}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return "connection";
  // A reply cut off by the signal while its body was being read.
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "timeout";
  }
  return "error";
}

// The worker's AI: Claude when AI_TRANSPORT=anthropic, otherwise none (every caller then uses its
// own fallback). One client per process for the key and model (P4.6), so its limit on calls at
// once and its breaker hold across jobs (each job asks for its deps afresh).
const clients = new Map<string, AnthropicAiClient>();

export function getAi(
  env: Pick<WorkerEnv, "AI_TRANSPORT" | "ANTHROPIC_API_KEY" | "AI_MODEL">,
): AiClient {
  if (env.AI_TRANSPORT !== "anthropic") return noAi;
  // The settings check refuses anthropic without a key (src/lib/env.ts); never call without one.
  if (!env.ANTHROPIC_API_KEY) throw new Error("AI_TRANSPORT=anthropic needs ANTHROPIC_API_KEY");
  const key = `${env.AI_MODEL}\n${env.ANTHROPIC_API_KEY}`;
  let ai = clients.get(key);
  if (!ai) {
    ai = new AnthropicAiClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
    clients.set(key, ai);
  }
  return ai;
}
