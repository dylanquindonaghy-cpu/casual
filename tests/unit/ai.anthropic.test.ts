import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_BREAKER_FAILURES,
  AI_BREAKER_OPEN_MS,
  AI_CALLS_AT_ONCE,
  ANTHROPIC_API_URL,
  AnthropicAiClient,
  getAi,
  type AnthropicTestOverrides,
} from "@/lib/ai/anthropic";
import { AI_TIMEOUT_MS } from "@/lib/ai/ask";
import { classifyMessage } from "@/lib/ai/classify-message";
import { AiUnavailableError, noAi, type AiRequest } from "@/lib/ai/client";
import { codeSummary, summarisePayGroup } from "@/lib/ai/pay-summary";
import { parseWorkerEnv } from "@/lib/env";
import { createLogger } from "@/lib/log";

// Claude through the Anthropic API (docs/office-v2.md 5.8; PLAN.md 12X.3), without any network:
// the official SDK is given a fake fetch that records each request and answers as the API would.

type FakeFetch = NonNullable<AnthropicTestOverrides["fetch"]>;
interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const KEY = "sk-ant-made-up-key-for-tests-only";
const SYSTEM = "You sort a made-up message.";
const PROMPT = "Can I swap my Saturday shift? My knee is bad again.";
const request: AiRequest = {
  purpose: "classify_message",
  system: SYSTEM,
  prompt: PROMPT,
  maxTokens: 5,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_made_up", ...headers },
  });

const message = (content: unknown[], stopReason: string | null = "end_turn") => ({
  id: "msg_made_up",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 42, output_tokens: 3 },
});

const apiError = (type: string, text: string) => ({
  type: "error",
  error: { type, message: text },
});

// A fake API: answers each request with `respond`, and keeps what was sent.
function fakeApi(respond: (sent: Sent, init: RequestInit) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch: FakeFetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const s: Sent = {
      url,
      headers: new Headers(init.headers as HeadersInit),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    };
    sent.push(s);
    return respond(s, init);
  };
  return { sent, fetch };
}

// The log lines the client writes, as objects.
function logs() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ write: (line) => lines.push(JSON.parse(line)) });
  return { lines, logger };
}

const client = (fetch: FakeFetch, extra: Omit<AnthropicTestOverrides, "fetch"> = {}) =>
  new AnthropicAiClient({ apiKey: KEY, model: "claude-haiku-4-5" }, { fetch, ...extra });

async function failure(promise: Promise<unknown>): Promise<AiUnavailableError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AiUnavailableError);
  return err as AiUnavailableError;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a call", () => {
  it("a text answer comes back", async () => {
    const api = fakeApi(() => json(200, message([{ type: "text", text: "shifts" }])));
    expect(await client(api.fetch).complete(request)).toBe("shifts");
    expect(api.sent).toHaveLength(1);
  });

  it("sends AI_MODEL, the system text, the prompt and the token limit, to the API's own address", async () => {
    const api = fakeApi(() => json(200, message([{ type: "text", text: "office" }])));
    const ai = new AnthropicAiClient(
      { apiKey: KEY, model: "claude-haiku-4-5-20251001" },
      { fetch: api.fetch },
    );
    await ai.complete(request);
    const [sent] = api.sent;
    expect(sent?.url).toBe(`${ANTHROPIC_API_URL}/v1/messages`);
    expect(sent?.body).toEqual({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      system: SYSTEM,
      messages: [{ role: "user", content: PROMPT }],
    });
    expect(sent?.headers.get("x-api-key")).toBe(KEY);
  });

  it("uses the settings' key and the API's address whatever the ANTHROPIC_* variables say", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-from-the-environment");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "made-up-bearer-token");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://somewhere-else.invalid");
    // The SDK always reads this one, and adds it after its own login header.
    vi.stubEnv(
      "ANTHROPIC_CUSTOM_HEADERS",
      "X-Api-Key: sk-ant-from-custom-headers\nAuthorization: Bearer made-up\nX-Made-Up: yes",
    );
    const api = fakeApi(() => json(200, message([{ type: "text", text: "office" }])));
    await client(api.fetch).complete(request);
    const [sent] = api.sent;
    expect(sent?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent?.headers.get("x-api-key")).toBe(KEY);
    expect(sent?.headers.get("authorization")).toBeNull();
    expect(sent?.headers.get("x-made-up")).toBeNull();
    // Only the SDK's own headers and the key go out.
    expect([...(sent?.headers.keys() ?? [])].sort()).toEqual([
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
  });

  it("the key comes from the settings: the file never reads process.env for it", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/ai/anthropic.ts"), "utf8");
    expect(source).not.toMatch(/process\.env(\.|\[\s*["'`])ANTHROPIC/);
    expect(() => new AnthropicAiClient({ apiKey: "", model: "claude-haiku-4-5" })).toThrow(
      /needs ANTHROPIC_API_KEY/,
    );
  });
});

describe("anything but a usable answer is AiUnavailableError, and nothing is retried", () => {
  it("429 (even when the API says to retry)", async () => {
    const api = fakeApi(() =>
      json(429, apiError("rate_limit_error", "made-up rate limit"), {
        "retry-after": "0",
        "x-should-retry": "true",
      }),
    );
    expect((await failure(client(api.fetch).complete(request))).message).toBe(
      "AI unavailable: http_429",
    );
    expect(api.sent).toHaveLength(1);
  });

  it("500 and 529 (overloaded)", async () => {
    for (const status of [500, 529]) {
      const api = fakeApi(() =>
        json(status, apiError("api_error", "made-up failure"), { "x-should-retry": "true" }),
      );
      expect((await failure(client(api.fetch).complete(request))).message).toBe(
        `AI unavailable: http_${status}`,
      );
      expect(api.sent, String(status)).toHaveLength(1);
    }
  });

  it("no reply within the time limit", async () => {
    // As real fetch does: the request is abandoned when its signal fires.
    const api = fakeApi(
      (_, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const started = Date.now();
    expect((await failure(client(api.fetch, { timeoutMs: 50 }).complete(request))).message).toBe(
      "AI unavailable: timeout",
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(api.sent).toHaveLength(1);
  });

  it("a reply that stalls after its headers is cut off at the time limit too (the signal)", async () => {
    // The SDK's own timeout ends once the headers arrive; the signal covers the body. The body
    // here errors when the request is aborted, as a real fetch's does.
    const api = fakeApi((_, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"msg_made_up",'));
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const outcome = await Promise.race([
      client(api.fetch, { timeoutMs: 50 })
        .complete(request)
        .then(
          () => "answered",
          (e: unknown) => (e instanceof AiUnavailableError ? e.message : "other error"),
        ),
      new Promise((resolve) => setTimeout(() => resolve("still waiting after 2 seconds"), 2000)),
    ]);
    expect(outcome).toBe("AI unavailable: timeout");
  });

  it("a reply without the expected shape (logged like any failure)", async () => {
    const { lines, logger } = logs();
    const api = fakeApi(() => json(200, { id: "msg_made_up", type: "message" }));
    expect((await failure(client(api.fetch, { logger }).complete(request))).message).toBe(
      "AI unavailable: error",
    );
    expect(lines).toEqual([
      expect.objectContaining({ msg: "AI call failed", stopReason: "error" }),
    ]);
  });

  it("a refusal, even with text", async () => {
    const api = fakeApi(() =>
      json(200, message([{ type: "text", text: "I can't help with that." }], "refusal")),
    );
    expect((await failure(client(api.fetch).complete(request))).message).toBe(
      "AI unavailable: refused",
    );
  });

  it("empty content, or only blank text", async () => {
    for (const content of [[], [{ type: "text", text: " \n " }]]) {
      const api = fakeApi(() => json(200, message(content)));
      expect((await failure(client(api.fetch).complete(request))).message).toBe(
        "AI unavailable: empty answer",
      );
    }
  });

  it("the SDK's client and every request are set to no retries and the 5-second limit", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/ai/anthropic.ts"), "utf8");
    expect(source).toMatch(/maxRetries: 0,\n/);
    expect(source).toMatch(
      /\{ signal: AbortSignal\.timeout\(this\.timeoutMs\), timeout: this\.timeoutMs, maxRetries: 0 \}/,
    );
    expect(source).toMatch(/this\.timeoutMs = overrides\.timeoutMs \?\? AI_TIMEOUT_MS;/);
    expect(AI_TIMEOUT_MS).toBe(5000);
  });
});

describe("under load (P4.6): one client a process, 4 calls at once, a breaker, no timers", () => {
  const answer = () => json(200, message([{ type: "text", text: "general" }]));
  const failed = () => json(500, apiError("api_error", "made-up failure"));
  // A fake API whose answers wait until let go, oldest first.
  function heldApi(respond: () => Response = answer) {
    const held: (() => void)[] = [];
    const api = fakeApi(
      () => new Promise<Response>((resolve) => held.push(() => resolve(respond()))),
    );
    return { ...api, letOneGo: () => held.shift()?.(), holding: () => held.length };
  }
  // Lets the SDK's own steps (building each request, reading each reply) run.
  const settle = async () => {
    for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };

  it("at most 4 calls at once; the rest go in order as calls finish", async () => {
    expect(AI_CALLS_AT_ONCE).toBe(4);
    const api = heldApi();
    const ai = client(api.fetch);
    const calls = Array.from({ length: 6 }, () => ai.complete(request));
    await settle();
    expect(api.sent).toHaveLength(4);
    api.letOneGo();
    await settle();
    expect(api.sent).toHaveLength(5);
    while (api.holding() > 0) {
      api.letOneGo();
      await settle();
    }
    expect(await Promise.all(calls)).toEqual(Array(6).fill("general"));
    expect(api.sent).toHaveLength(6);
  });

  it("a call still waiting when its 5 seconds are up is turned away (busy) at its turn, without calling the API", async () => {
    let clock = 1_000_000;
    const { lines, logger } = logs();
    const api = heldApi();
    const ai = client(api.fetch, { now: () => clock, logger });
    const going = Array.from({ length: 4 }, () => ai.complete(request));
    // Its failure is read as soon as it's asked (it comes while the test lets the others go).
    const late = failure(ai.complete(request));
    await settle();
    clock += AI_TIMEOUT_MS + 1;
    // Asked now, so still in time when the turn comes.
    const onTime = ai.complete(request);
    api.letOneGo();
    await settle();
    expect((await late).message).toBe("AI unavailable: busy");
    expect(api.sent).toHaveLength(5); // the turn went to the one in time
    while (api.holding() > 0) {
      api.letOneGo();
      await settle();
    }
    expect(await Promise.all([...going, onTime])).toEqual(Array(5).fill("general"));
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", msg: "AI call not made", stopReason: "busy" }),
    );
  });

  it("after 5 failed calls in a row the breaker opens: calls fail at once for 30 s, then one trial", async () => {
    let clock = 1_000_000;
    let mode: "fail" | "answer" | "hold" = "fail";
    const held: (() => void)[] = [];
    const api = fakeApi(() =>
      mode === "hold"
        ? new Promise<Response>((resolve) => held.push(() => resolve(answer())))
        : mode === "fail"
          ? failed()
          : answer(),
    );
    const { lines, logger } = logs();
    const ai = client(api.fetch, { now: () => clock, logger });
    expect(AI_BREAKER_FAILURES).toBe(5);
    expect(AI_BREAKER_OPEN_MS).toBe(30_000);
    for (let i = 0; i < 5; i += 1) {
      expect((await failure(ai.complete(request))).message).toBe("AI unavailable: http_500");
    }
    // Open: at once, and nothing sent, until the 30 seconds are up.
    expect((await failure(ai.complete(request))).message).toBe("AI unavailable: breaker_open");
    clock += AI_BREAKER_OPEN_MS - 1;
    expect((await failure(ai.complete(request))).message).toBe("AI unavailable: breaker_open");
    expect(api.sent).toHaveLength(5);
    // Then one trial: it fails, so open for another 30 seconds.
    clock += 1;
    expect((await failure(ai.complete(request))).message).toBe("AI unavailable: http_500");
    expect(api.sent).toHaveLength(6);
    expect((await failure(ai.complete(request))).message).toBe("AI unavailable: breaker_open");
    // The next trial answers. While it's going, every other call fails at once.
    clock += AI_BREAKER_OPEN_MS;
    mode = "hold";
    const trial = ai.complete(request);
    await settle();
    expect(api.sent).toHaveLength(7);
    expect((await failure(ai.complete(request))).message).toBe("AI unavailable: breaker_open");
    expect(api.sent).toHaveLength(7);
    held.shift()?.();
    expect(await trial).toBe("general");
    // Closed again.
    mode = "answer";
    expect(await ai.complete(request)).toBe("general");
    expect(api.sent).toHaveLength(8);
    expect(lines.filter((l) => String(l.msg).startsWith("AI breaker"))).toEqual([
      expect.objectContaining({ level: "warn", msg: "AI breaker open", failures: 5 }),
      expect.objectContaining({ level: "info", msg: "AI breaker closed" }),
    ]);
  });

  it("a refusal or an empty answer is the API working (it never opens the breaker), and an answer starts the count again", async () => {
    const refusals = fakeApi(() => json(200, message([{ type: "text", text: "no" }], "refusal")));
    const ai = client(refusals.fetch);
    for (let i = 0; i < 6; i += 1) {
      expect((await failure(ai.complete(request))).message).toBe("AI unavailable: refused");
    }
    expect(refusals.sent).toHaveLength(6);
    let n = 0;
    const mixed = fakeApi(() => {
      n += 1;
      return n === 5 ? answer() : failed();
    });
    const again = client(mixed.fetch);
    // 4 failures, an answer, 4 failures: never 5 in a row.
    for (let i = 0; i < 9; i += 1) await again.complete(request).catch(() => undefined);
    expect((await failure(again.complete(request))).message).toBe("AI unavailable: http_500");
    expect(mixed.sent).toHaveLength(10);
  });

  it("getAi gives one client a process for a key and model, so its limits hold across jobs", () => {
    const env = {
      AI_TRANSPORT: "anthropic" as const,
      ANTHROPIC_API_KEY: KEY,
      AI_MODEL: "claude-haiku-4-5",
    };
    const ai = getAi(env);
    expect(getAi({ ...env })).toBe(ai);
    expect(getAi({ ...env, AI_MODEL: "claude-sonnet-4-6" })).not.toBe(ai);
  });

  it("no timers: the limit and the breaker read the clock as calls come and go", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/ai/anthropic.ts"), "utf8");
    expect(source).not.toMatch(/\bset(Timeout|Interval|Immediate)\(/);
  });
});

describe("the code's fallback runs when the AI is unavailable", () => {
  it("the shifts line's sorting gives no label (the office gets the message)", async () => {
    const api = fakeApi(() => json(429, apiError("rate_limit_error", "made-up rate limit")));
    expect(await classifyMessage(PROMPT, client(api.fetch))).toBeNull();
    const ok = fakeApi(() => json(200, message([{ type: "text", text: "cancel" }])));
    expect(await classifyMessage(PROMPT, client(ok.fetch))).toBe("cancel");
  });

  it("payroll's group gets the app's own line", async () => {
    const facts = {
      count: 3,
      issue: "wrong_rate" as const,
      week: "2026-09-07",
      site: null,
      ratesPence: [1250],
    };
    const api = fakeApi(() =>
      json(200, message([{ type: "text", text: "Not something I can do." }], "refusal")),
    );
    expect(await summarisePayGroup(facts, client(api.fetch))).toEqual({
      text: codeSummary(facts),
      byAi: false,
    });
  });
});

describe("the log", () => {
  it("purpose, model, tokens and stop reason only: never the prompt, the answer or the key", async () => {
    const answer = "made-up-answer-text";
    const { lines, logger } = logs();
    const ok = fakeApi(() => json(200, message([{ type: "text", text: answer }])));
    await client(ok.fetch, { logger }).complete(request);
    const refused = fakeApi(() => json(200, message([{ type: "text", text: answer }], "refusal")));
    await client(refused.fetch, { logger })
      .complete(request)
      .catch(() => undefined);
    const limited = fakeApi(() => json(429, apiError("rate_limit_error", "made-up api words")));
    await client(limited.fetch, { logger })
      .complete(request)
      .catch(() => undefined);

    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      ["info", "AI answered"],
      ["warn", "AI answer not used"],
      ["warn", "AI call failed"],
    ]);
    const fields = (l: Record<string, unknown>) =>
      Object.keys(l)
        .filter((k) => !["ts", "level", "msg"].includes(k))
        .sort();
    expect(fields(lines[0] ?? {})).toEqual(["model", "purpose", "stopReason", "usage"]);
    expect(lines[0]).toEqual({
      ts: expect.any(String),
      level: "info",
      msg: "AI answered",
      purpose: "classify_message",
      model: "claude-haiku-4-5",
      usage: { input: 42, output: 3 },
      stopReason: "end_turn",
    });
    expect(lines[1]).toMatchObject({ stopReason: "refusal" });
    expect(fields(lines[2] ?? {})).toEqual(["model", "purpose", "stopReason"]);
    expect(lines[2]).toMatchObject({ stopReason: "http_429" });
    const written = JSON.stringify(lines);
    for (const secret of [PROMPT, SYSTEM, answer, KEY, "made-up api words"]) {
      expect(written).not.toContain(secret);
    }
  });

  it("the SDK's own logging stays off, even with ANTHROPIC_LOG=debug", async () => {
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const { logger } = logs();
    const ok = fakeApi(() => json(200, message([{ type: "text", text: "office" }])));
    await client(ok.fetch, { logger }).complete(request);
    const failed = fakeApi(() => json(500, apiError("api_error", "made-up failure")));
    await client(failed.fetch, { logger })
      .complete(request)
      .catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("tests never reach the API", () => {
  it("under NODE_ENV=test, a client without a test's fake fetch refuses before sending anything", async () => {
    // Blocked too, so even a broken guard sends nothing anywhere.
    const real = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("tests never reach the network"));
    const ai = new AnthropicAiClient({ apiKey: KEY, model: "claude-haiku-4-5" });
    expect((await failure(ai.complete(request))).message).toBe(
      "AI unavailable: tests never call the Anthropic API",
    );
    expect(real).not.toHaveBeenCalled();
  });

  it("the tests themselves run with AI off and no key (tests/setup/env.ts)", () => {
    expect(process.env.AI_TRANSPORT).toBe("none");
    expect(process.env.ANTHROPIC_API_KEY).toBe("");
  });
});

describe("getAi", () => {
  it("none unless AI_TRANSPORT=anthropic; then Claude with the settings' key and model", () => {
    expect(
      getAi({ AI_TRANSPORT: "none", ANTHROPIC_API_KEY: KEY, AI_MODEL: "claude-haiku-4-5" }),
    ).toBe(noAi);
    const ai = getAi({
      AI_TRANSPORT: "anthropic",
      ANTHROPIC_API_KEY: KEY,
      AI_MODEL: "claude-haiku-4-5",
    });
    expect(ai).toBeInstanceOf(AnthropicAiClient);
    expect(ai.name).toBe("anthropic");
    expect(() =>
      getAi({
        AI_TRANSPORT: "anthropic",
        ANTHROPIC_API_KEY: undefined,
        AI_MODEL: "claude-haiku-4-5",
      }),
    ).toThrow(/needs ANTHROPIC_API_KEY/);
  });
});

describe("the settings (worker only)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-made-up-session-secret-0123456789abcd",
    APP_BASE_DOMAIN: "localhost:3000",
    NODE_ENV: "development",
  };
  const refusal = (source: Record<string, string>) => {
    try {
      parseWorkerEnv({ ...base, ...source });
      return "accepted";
    } catch (err) {
      return String((err as Error).message);
    }
  };

  it("none by default, Haiku by default, an empty value means not set", () => {
    const env = parseWorkerEnv({ ...base, AI_TRANSPORT: "", ANTHROPIC_API_KEY: "", AI_MODEL: "" });
    expect([env.AI_TRANSPORT, env.ANTHROPIC_API_KEY, env.AI_MODEL]).toEqual([
      "none",
      undefined,
      "claude-haiku-4-5",
    ]);
    expect(parseWorkerEnv(base).AI_TRANSPORT).toBe("none");
  });

  it("anthropic needs a key; it is refused under NODE_ENV=test", () => {
    expect(refusal({ AI_TRANSPORT: "anthropic" })).toMatch(/needs ANTHROPIC_API_KEY/);
    expect(refusal({ AI_TRANSPORT: "anthropic", ANTHROPIC_API_KEY: "" })).toMatch(
      /needs ANTHROPIC_API_KEY/,
    );
    expect(refusal({ AI_TRANSPORT: "anthropic", ANTHROPIC_API_KEY: KEY })).toBe("accepted");
    expect(
      refusal({ AI_TRANSPORT: "anthropic", ANTHROPIC_API_KEY: KEY, NODE_ENV: "test" }),
    ).toMatch(/anthropic is refused when NODE_ENV=test/);
    expect(refusal({ AI_TRANSPORT: "bedrock" })).not.toBe("accepted");
  });

  it("AI_MODEL must be a Claude model id", () => {
    expect(refusal({ AI_MODEL: "claude-haiku-4-5-20251001" })).toBe("accepted");
    expect(refusal({ AI_MODEL: "anthropic.claude-haiku-4-5" })).not.toBe("accepted");
    expect(refusal({ AI_MODEL: "gpt-4o" })).not.toBe("accepted");
    expect(refusal({ AI_MODEL: "claude haiku" })).not.toBe("accepted");
  });
});
