import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "@/lib/env";
import { passesLogCheck } from "@/lib/events/record";
import { getTransport, webexCredentials } from "@/lib/messaging";
import { ChannelRefusedError, NoTextSenderError } from "@/lib/messaging/transport";
import {
  createWebexTransport,
  WEBEX_SMS_URL,
  WEBEX_TIMEOUT_MS,
  WebexSendError,
  type WebexCredentials,
} from "@/lib/messaging/webex";
import { runAsFirm } from "@/lib/tenancy/job-firm";

// Texts through a firm's own Webex Interact account (Phase 15; src/lib/messaging/webex.ts), built
// and switched off: never the real service here (a stand-in for the network). The request as
// Webex Interact's public reference describes it, the firm from the job running, and each failure a
// code only. Made-up keys, numbers (Ofcom's drama range) and ids.

const FIRM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CREDS: WebexCredentials = { apiKey: "made-up-webex-key-0001", sender: "ACMESHIFTS" };
const TO = "+447700900123";

function harness(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const looked: string[] = [];
  const transport = createWebexTransport({
    credentialsFor: async (firmId) => {
      looked.push(firmId);
      return firmId === FIRM ? CREDS : null;
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return answer();
    }) as typeof fetch,
  });
  return { transport, calls, looked };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const queued = (tid = "tid-0001") =>
  json(200, {
    request_id: "req-0001",
    messages: [{ transaction_id: tid, to: TO, status: "queued", code: 1001 }],
    errors: [],
  });
const text = { channel: "sms" as const, to: TO, body: "Your shift on Saturday is confirmed." };
const inFirm = <T>(fn: () => Promise<T>, firmId = FIRM) => runAsFirm(firmId, fn);
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return "sent";
  } catch (err) {
    return err instanceof WebexSendError ? err.failure : String(err);
  }
};

describe("a text through Webex Interact", () => {
  it("as its reference says: POST /v1/sms, the key in X-AUTH-KEY, {message_body, from, to: [{phone}]}", async () => {
    const h = harness(() => queued("tid-9"));
    expect(await inFirm(() => h.transport.send(text))).toEqual({
      providerMessageId: "webex-tid-9",
    });
    expect(h.looked).toEqual([FIRM]);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call?.url).toBe(WEBEX_SMS_URL);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({
      "X-AUTH-KEY": CREDS.apiKey,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      message_body: text.body,
      from: CREDS.sender,
      to: [{ phone: [TO] }],
    });
    // A timeout on every request, and no following a redirect elsewhere.
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.init.redirect).toBe("error");
  });

  it("every request gives up after its time: one that never answers is unavailable (10 seconds unless set)", async () => {
    let aborted = false;
    const transport = createWebexTransport({
      credentialsFor: async () => CREDS,
      timeoutMs: 20,
      // A service that never answers: only the request's own timeout ends it.
      fetch: ((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(init.signal?.reason);
          });
        })) as typeof fetch,
    });
    const started = performance.now();
    expect(await failure(inFirm(() => transport.send(text)))).toBe("unavailable");
    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(WEBEX_TIMEOUT_MS).toBe(10_000);
  });

  it("the firm is the job's: outside a firm's job nothing is sent; a firm with no key has no text sender (its messages go by email)", async () => {
    const h = harness(() => queued());
    expect(await failure(h.transport.send(text))).toBe("no_firm");
    await expect(inFirm(() => h.transport.send(text), OTHER)).rejects.toBeInstanceOf(
      NoTextSenderError,
    );
    expect(h.calls).toEqual([]);
  });

  it("the id kept only in a form the action log accepts: a digit-heavy one becomes a stand-in of letters", async () => {
    const h = harness(() => queued("4471234567890123"));
    const { providerMessageId } = await inFirm(() => h.transport.send(text));
    expect(providerMessageId).toMatch(/^webex-h-[a-p]{24}$/);
    expect(passesLogCheck({ providerMessageId })).toBe(true);
    // The same id, the same stand-in.
    const again = await inFirm(() =>
      harness(() => queued("4471234567890123")).transport.send(text),
    );
    expect(again.providerMessageId).toBe(providerMessageId);
  });

  it("a test that builds it without a stand-in for the network is refused before anything goes", async () => {
    const real = createWebexTransport({ credentialsFor: async () => CREDS });
    await expect(inFirm(() => real.send(text))).rejects.toThrow(/tests never send a real text/);
  });

  it("a WhatsApp is refused as a channel it won't carry (the casual gets the text); email never comes here", async () => {
    const h = harness(() => queued());
    const whatsapp = { channel: "whatsapp" as const, to: TO, body: "Hi" };
    await expect(inFirm(() => h.transport.send(whatsapp))).rejects.toBeInstanceOf(
      ChannelRefusedError,
    );
    // A firm with no key has no text sender on any channel, a WhatsApp too: so its casual's
    // message goes by email, even one who replied STOP to texts (src/lib/notify/send.ts).
    const keyless = await inFirm(() => h.transport.send(whatsapp), OTHER).catch((e: unknown) => e);
    expect(keyless).toBeInstanceOf(NoTextSenderError);
    expect((keyless as NoTextSenderError).channel).toBe("whatsapp");
    await expect(
      inFirm(() =>
        h.transport.send({ channel: "email", to: "ann@example.com", subject: "Hi", body: "Hi" }),
      ),
    ).rejects.toThrow(/never goes through Webex/);
    expect(h.calls).toEqual([]);
  });

  it("each failure a code, never the number, the text or the key", async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => json(401, { errors: [{ code: 401 }] }), "unauthorised"],
      [() => json(403, {}), "unauthorised"],
      [() => json(429, {}), "rate_limited"],
      [() => json(503, {}), "unavailable"],
      [() => Promise.reject(new DOMException("timed out", "TimeoutError")), "unavailable"],
      [
        () => json(400, { errors: [{ code: 10005, message: "Insufficient balance" }] }),
        "no_balance",
      ],
      [
        () => json(400, { errors: [{ code: 10006, field: "to", message: "No numbers" }] }),
        "refused",
      ],
      [
        () =>
          json(200, {
            request_id: "req-1",
            messages: [],
            errors: [{ to: TO, status: "error", code: 1002, message: "Invalid number" }],
          }),
        "refused",
      ],
      [() => new Response("<html>not json</html>", { status: 200 }), "bad_answer"],
      [() => json(200, { unexpected: true, messages: "no" }), "bad_answer"],
      [() => json(302, {}), "bad_answer"],
      [
        () =>
          json(200, {
            messages: [{ transaction_id: "tid-x", to: TO, status: "error", code: 1002 }],
            errors: [{ to: TO, status: "error", code: 1002 }],
          }),
        "refused",
      ],
    ];
    for (const [answer, expected] of cases) {
      const h = harness(answer);
      let caught: unknown;
      try {
        await inFirm(() => h.transport.send(text));
      } catch (err) {
        caught = err;
      }
      expect(caught, expected).toBeInstanceOf(WebexSendError);
      const err = caught as WebexSendError;
      expect(err.failure).toBe(expected);
      // What the send's log entry records (an error's name).
      expect(err.name).toBe(`webex_${expected}`);
      expect(`${err.name} ${err.message}`).not.toMatch(/900123|Saturday|made-up-webex-key/);
    }
  });
});

describe("the setting (worker only)", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-made-up-session-secret-0123456789abcd",
    APP_BASE_DOMAIN: "localhost:3000",
    NODE_ENV: "development",
  };
  const SECRETS_KEY = randomBytes(32).toString("base64");
  const refusal = (source: Record<string, string>) => {
    try {
      parseWorkerEnv({ ...base, ...source });
      return "accepted";
    } catch (err) {
      return String((err as Error).message);
    }
  };

  it("webex needs the secret store's key, and is refused under NODE_ENV=test", () => {
    expect(refusal({ MESSAGING_TRANSPORT: "webex", SECRETS_KEY })).toBe("accepted");
    expect(refusal({ MESSAGING_TRANSPORT: "webex" })).toMatch(/set SECRETS_KEY/);
    expect(refusal({ MESSAGING_TRANSPORT: "webex", SECRETS_KEY, NODE_ENV: "test" })).toMatch(
      /webex is refused when NODE_ENV=test/,
    );
  });

  it("refused in production until 15.1 makes everything texts (the login link still goes by WhatsApp)", () => {
    expect(refusal({ MESSAGING_TRANSPORT: "webex", SECRETS_KEY, NODE_ENV: "production" })).toMatch(
      /webex waits for 15.1/,
    );
  });

  it("email still goes with webex on (printed, without SMTP); each firm's key and sender read by name", async () => {
    const transport = getTransport({
      MESSAGING_TRANSPORT: "webex",
      NODE_ENV: "development",
      EMAIL_TRANSPORT: "console",
    });
    const printed = await transport.send({
      channel: "email",
      to: "office@example.com",
      subject: "Hello",
      body: "Hello",
    });
    expect(printed.providerMessageId).toMatch(/^console-/);
    const asked: string[] = [];
    const store: Record<string, string> = {
      [`${FIRM}:webex.api_key`]: "made-up-webex-key-0001",
      [`${FIRM}:webex.sender`]: "ACMESHIFTS",
      [`${OTHER}:webex.api_key`]: "made-up-webex-key-0002",
    };
    const credentials = webexCredentials({}, async (firmId, name) => {
      asked.push(name);
      return store[`${firmId}:${name}`] ?? null;
    });
    expect(await credentials(FIRM)).toEqual(CREDS);
    // A key with no sender: none.
    expect(await credentials(OTHER)).toBeNull();
    expect([...new Set(asked)].sort()).toEqual(["webex.api_key", "webex.sender"]);
  });

  it("the tests themselves print texts (tests/setup/env.ts)", () => {
    expect(process.env.MESSAGING_TRANSPORT).toBe("console");
  });
});
