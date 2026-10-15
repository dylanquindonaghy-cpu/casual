import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWorkerEnv } from "@/lib/env";
import { passesLogCheck } from "@/lib/events/record";
import { webhookDeliverPayload, webhookOf } from "@/lib/integrations/outbox";
import {
  EVENT_ID_PATTERN,
  keyFromSigningSecret,
  signingKey,
  signingSecret,
  testEventId,
  webhookEventId,
} from "@/lib/integrations/secrets";
import {
  addressHint,
  checkWebhookAddress,
  isPublicAddress,
  publicAddressOf,
  sendWebhook,
  transmit,
  WebhookSendError,
  type RequestFn,
} from "@/lib/integrations/send";
import { signature, signedHeaders, verifySignature } from "@/lib/integrations/sign";
import { createConsoleWebhookTransport } from "@/lib/integrations/webhook-transport";
import { TEST_PING_MESSAGE, WEBHOOK_SCHEMAS } from "@/lib/integrations/webhooks";
import { eventWords } from "@/lib/office/event-words";

// The planner's webhooks, the pure parts (12J.2; docs/office-v2.md 5.3.3): Standard Webhooks
// signing, the derived secrets and event ids, the address checks on save and on each try, one POST
// to the checked address (against a local server: nothing reaches the internet), the body
// contracts, the worker's setting and the new log entries.

const SECRET = "test-only-integrations-secret-not-for-any-real-use";
const FIRM_A = "6f1c0e2a-0000-4000-8000-0000000000a1";
const FIRM_B = "6f1c0e2a-0000-4000-8000-0000000000b2";

describe("Standard Webhooks signing", () => {
  it("reproduces the spec's published example", () => {
    // From the Standard Webhooks specification's own test vector.
    const key = keyFromSigningSecret("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw");
    expect(signature(key, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}')).toBe(
      "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    );
  });

  it("signs each try with its own timestamp; a receiver checks it within 5 minutes", () => {
    const key = signingKey(SECRET, FIRM_A, 1);
    const body = '{"type":"test.ping"}';
    const h = signedHeaders(key, "evt_x", 1_800_000_000, body);
    expect(h).toEqual({
      "webhook-id": "evt_x",
      "webhook-timestamp": "1800000000",
      "webhook-signature": signature(key, "evt_x", 1_800_000_000, body),
      "content-type": "application/json",
      "user-agent": "ShiftDesk-Webhooks/1",
    });
    const check = (o: { at?: number; body?: string; key?: Buffer; sig?: string }) =>
      verifySignature(
        o.key ?? key,
        { id: "evt_x", timestamp: "1800000000", signature: o.sig ?? h["webhook-signature"] },
        o.body ?? body,
        o.at ?? 1_800_000_000,
      );
    expect(check({})).toBe(true);
    expect(check({ at: 1_800_000_000 + 299 })).toBe(true);
    expect(check({ at: 1_800_000_000 + 301 })).toBe(false);
    expect(check({ body: '{"type":"test.pong"}' })).toBe(false);
    expect(check({ key: signingKey(SECRET, FIRM_A, 2) })).toBe(false);
    expect(check({ sig: `v1,bad ${h["webhook-signature"]}` })).toBe(true);
  });

  it("the secret is whsec_ plus the derived key, different per firm and per version", () => {
    const s1 = signingSecret(SECRET, FIRM_A, 1);
    expect(s1).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(keyFromSigningSecret(s1)).toEqual(signingKey(SECRET, FIRM_A, 1));
    expect(signingSecret(SECRET, FIRM_A, 2)).not.toBe(s1);
    expect(signingSecret(SECRET, FIRM_B, 1)).not.toBe(s1);
    expect(signingSecret("another-secret-of-at-least-32-characters", FIRM_A, 1)).not.toBe(s1);
  });

  it("event ids: the same on every try, different between firms, letters only, and log-safe", () => {
    const a = webhookEventId(SECRET, FIRM_A, 42);
    expect(a).toMatch(EVENT_ID_PATTERN);
    expect(webhookEventId(SECRET, FIRM_A, 42)).toBe(a);
    expect(webhookEventId(SECRET, FIRM_B, 42)).not.toBe(a);
    expect(webhookEventId(SECRET, FIRM_A, 43)).not.toBe(a);
    expect(testEventId(SECRET, FIRM_A, "6f1c0e2a-0000-4000-8000-000000000042")).not.toBe(a);
    // Never the log's own number, and never a run of digits the log would take for a phone.
    for (let i = 1; i < 2000; i++) {
      const id = webhookEventId(SECRET, FIRM_A, i);
      expect(id).toMatch(/^evt_[A-Za-z]{22}$/);
      expect(passesLogCheck({ eventRef: id })).toBe(true);
    }
  });
});

describe("the address, when it's saved", () => {
  const base = "shiftdesk.co.uk";
  it("accepts an https DNS name (a fragment dropped) and shows only its host and last 4", () => {
    expect(
      checkWebhookAddress(" https://Hooks.Zapier.com/hooks/catch/1/k3F9?x=1#top ", base),
    ).toEqual({
      ok: true,
      url: "https://hooks.zapier.com/hooks/catch/1/k3F9?x=1",
      host: "hooks.zapier.com",
    });
    expect(checkWebhookAddress("https://hooks.example:443/a", base)).toMatchObject({ ok: true });
    expect(addressHint("https://hooks.zapier.com/hooks/catch/1/k3F9")).toBe(
      "https://hooks.zapier.com/…k3F9",
    );
  });

  it.each([
    ["", "not_an_address"],
    ["not a url", "not_an_address"],
    ["http://hooks.example/a", "not_https"],
    ["ftp://hooks.example/a", "not_https"],
    ["https://user:pw@hooks.example/a", "credentials"],
    ["https://hooks.example:8443/a", "port"],
    ["https://203.0.113.10/a", "ip_address"],
    ["https://[2001:db8::1]/a", "ip_address"],
    ["https://0x7f000001/a", "ip_address"],
    ["https://shiftdesk.co.uk/a", "ours"],
    ["https://acme.shiftdesk.co.uk/a", "ours"],
    ["https://localhost/a", "not_an_address"],
    ["https://intranet/a", "not_an_address"],
    [`https://hooks.example/${"a".repeat(500)}`, "too_long"],
  ])("refuses %s (%s)", (address, problem) => {
    expect(checkWebhookAddress(address, base)).toEqual({ ok: false, problem });
  });
});

describe("the address, on each try: only public addresses", () => {
  it.each([
    "0.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254", // the cloud metadata address
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::127.0.0.1", // IPv4-compatible
    "::ffff:127.0.0.1", // IPv4-mapped
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1", // NAT64 of 10.0.0.1
    "64:ff9b::7f00:1",
    "2002:a00:1::1", // 6to4 of 10.0.0.1
    "2002:7f00:1::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "100::1", // outside 2000::/3
    "not an address",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:2800:21f:cb07::1", "2a00:1450::1"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("a name with any refused address is refused, even beside a public one; no answer is dns", async () => {
    const both = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(publicAddressOf("hooks.example", both)).rejects.toMatchObject({
      code: "refused_address",
    });
    await expect(
      publicAddressOf("hooks.example", async () => [{ address: "93.184.215.14", family: 4 }]),
    ).resolves.toEqual({ address: "93.184.215.14", family: 4 });
    await expect(publicAddressOf("hooks.example", async () => [])).rejects.toMatchObject({
      code: "dns",
    });
    await expect(
      publicAddressOf("hooks.example", async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND hooks.example"), {
          code: "ENOTFOUND",
        });
      }),
    ).rejects.toMatchObject({ code: "dns" });
  });

  it("a name server that never answers: dns, within the look-up's own limit", async () => {
    const started = Date.now();
    await expect(
      publicAddressOf("hooks.example", () => new Promise(() => undefined), 200),
    ).rejects.toMatchObject({ code: "dns" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a stored address that's no longer acceptable is refused before any look-up", async () => {
    let looked = 0;
    const resolve = async () => {
      looked += 1;
      return [{ address: "93.184.215.14", family: 4 }];
    };
    for (const url of [
      "http://hooks.example/a",
      "https://10.0.0.1/a",
      "https://hooks.example:8080/a",
    ]) {
      await expect(
        sendWebhook({ url, headers: {}, body: "{}" }, { resolve }),
      ).rejects.toMatchObject({
        code: "refused_address",
      });
    }
    expect(looked).toBe(0);
  });
});

describe("one POST to the checked address (a local server)", () => {
  let server: Server;
  let port = 0;
  const seen: { host: string | undefined; path: string | undefined; body: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        seen.push({ host: req.headers.host, path: req.url, body });
        switch (req.url) {
          case "/ok":
            res.writeHead(204).end();
            return;
          case "/redirect":
            res.writeHead(302, { location: "http://127.0.0.1/admin" }).end();
            return;
          case "/error":
            res.writeHead(500).end("broken");
            return;
          case "/big":
            res.writeHead(200);
            res.write("x".repeat(64 * 1024));
            return; // never ends: only the first 1 KB is read
          case "/hang":
            return; // never answers
          default:
            res.writeHead(404).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  // The name is a made-up one: only the lookup option can make it reach this server.
  const post = (path: string, o: { connectMs?: number; totalMs?: number } = {}) =>
    transmit({
      url: new URL(`http://hooks.example.invalid:${port}${path}`),
      address: "127.0.0.1",
      family: 4,
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
      request: httpRequest as RequestFn,
      ...(o.connectMs ? { connectTimeoutMs: o.connectMs } : {}),
      ...(o.totalMs ? { totalTimeoutMs: o.totalMs } : {}),
    });

  it("goes to the checked address, with the name kept for the Host (and so for TLS)", async () => {
    await expect(post("/ok")).resolves.toEqual({ status: 204 });
    expect(seen.at(-1)).toEqual({
      host: `hooks.example.invalid:${port}`,
      path: "/ok",
      body: '{"a":1}',
    });
  });

  it("a redirect isn't followed; an error status, a timeout: a code, never the address", async () => {
    const codeOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return "resolved";
      } catch (err) {
        expect(err).toBeInstanceOf(WebhookSendError);
        expect(String((err as Error).message)).not.toMatch(
          /hooks\.example|127\.0\.0\.1|\/redirect|\/error|\/hang/,
        );
        return (err as WebhookSendError).code;
      }
    };
    const before = seen.length;
    expect(await codeOf(post("/redirect"))).toBe("redirect");
    expect(seen.length).toBe(before + 1); // the redirect's target was never asked
    expect(await codeOf(post("/error"))).toBe("http_500");
    expect(await codeOf(post("/hang", { totalMs: 300 }))).toBe("timeout");
  });

  it("reads at most 1 KB of the answer", async () => {
    const started = Date.now();
    await expect(post("/big", { totalMs: 5_000 })).resolves.toEqual({ status: 200 });
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("nothing listening: a connection failure, by code", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const free = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    await expect(
      transmit({
        url: new URL(`http://hooks.example.invalid:${free}/x`),
        address: "127.0.0.1",
        family: 4,
        headers: {},
        body: "{}",
        request: httpRequest as RequestFn,
      }),
    ).rejects.toMatchObject({ code: "connection" });
  });
});

describe("the console transport", () => {
  it("prints the signed request with the address cut to its host", async () => {
    const lines: string[] = [];
    await createConsoleWebhookTransport((l) => lines.push(l)).send({
      url: "https://hooks.example/hooks/catch/123456/k3F9",
      headers: { "webhook-id": "evt_x" },
      body: '{"type":"test.ping"}',
    });
    expect(lines.join("\n")).toContain("POST https://hooks.example/…");
    expect(lines.join("\n")).toContain("webhook-id: evt_x");
    expect(lines.join("\n")).not.toContain("catch/123456");
  });
});

describe("the bodies: one zod contract per type", () => {
  const session = {
    id: "0b9e0000-0000-4000-8000-000000000001",
    ref: "RACEDAY-STW-0710",
    source: "api",
    event: { id: "41d20000-0000-4000-8000-000000000001", ref: "RACEDAY-2026", name: "Raceday" },
    site: { name: "Acme Demo Racecourse", postcode: "ZZ9 9ZZ" },
    role: "steward",
    starts_at: "2026-10-07T09:30:00Z",
    ends_at: "2026-10-07T17:30:00Z",
    status: "open",
    places: 6,
    booked: 5,
    pay_rate_pence: 1260,
    post: "Gate B",
    meeting_point: "Staff entrance, Gate B",
    uniform: "Black trousers, boots. Hi-vis provided.",
    requirements: [],
  };
  const booking = {
    id: "b71e0c42-0000-4000-8000-000000000001",
    ref: "B71E0C42",
    status: "cancelled",
    casual: {
      id: "9a0d0000-0000-4000-8000-000000000001",
      staff_ref: "ST-0042",
      first_name: "Kieran",
      last_name: "Doyle",
    },
    booked_at: "2026-10-01T12:00:00Z",
    booked_by: "casual",
    cancellation: {
      at: "2026-10-06T18:05:12Z",
      by: "casual",
      via: "app",
      notice_hours: 15.42,
      reason_code: "casual_own_reason",
      strike: { status: "issued", live_strikes: 2 },
    },
  };
  // docs/office-v2.md 5.3.3's sample body.
  const sample = {
    id: "evt_QxmNpRsTvWyZbAaCdEfGhI",
    type: "booking.cancelled",
    timestamp: "2026-10-06T18:05:12Z",
    firm: { id: "6f1c0e2a-0000-4000-8000-000000000001", slug: "acme" },
    data: { session, booking },
  };

  it("the spec's sample parses; anything more (a mobile, an email, a postcode, a reason's words) doesn't", () => {
    expect(WEBHOOK_SCHEMAS["booking.cancelled"].parse(sample)).toEqual(sample);
    const withMore = [
      {
        ...sample,
        data: {
          ...sample.data,
          booking: { ...booking, casual: { ...booking.casual, mobile: "+447700900123" } },
        },
      },
      {
        ...sample,
        data: {
          ...sample.data,
          booking: { ...booking, casual: { ...booking.casual, email: "k@example.com" } },
        },
      },
      {
        ...sample,
        data: {
          ...sample.data,
          booking: { ...booking, casual: { ...booking.casual, postcode: "ZZ1 1AA" } },
        },
      },
      {
        ...sample,
        data: {
          ...sample.data,
          booking: { ...booking, cancellation: { ...booking.cancellation, reason: "I'm unwell" } },
        },
      },
      {
        ...sample,
        data: {
          ...sample.data,
          booking: {
            ...booking,
            cancellation: { ...booking.cancellation, reason_code: "I'm unwell" },
          },
        },
      },
      { ...sample, data: { ...sample.data, travel: { minutes: 12 } } },
      { ...sample, extra: true },
    ];
    for (const body of withMore)
      expect(WEBHOOK_SCHEMAS["booking.cancelled"].safeParse(body).success).toBe(false);
  });

  it("a body missing a field fails, even when nothing in it is private", () => {
    const { pay_rate_pence: _pay, ...noPay } = session;
    void _pay;
    expect(
      WEBHOOK_SCHEMAS["booking.cancelled"].safeParse({
        ...sample,
        data: { session: noPay, booking },
      }).success,
    ).toBe(false);
    const { strike: _strike, ...noStrike } = booking.cancellation;
    void _strike;
    expect(
      WEBHOOK_SCHEMAS["booking.cancelled"].safeParse({
        ...sample,
        data: { session, booking: { ...booking, cancellation: noStrike } },
      }).success,
    ).toBe(false);
  });

  it("an erased casual is null with erased: true, and only then", () => {
    const erased = { ...booking, casual: null, erased: true };
    expect(
      WEBHOOK_SCHEMAS["booking.cancelled"].safeParse({
        ...sample,
        data: { session, booking: erased },
      }).success,
    ).toBe(true);
    for (const b of [
      { ...booking, casual: null },
      { ...booking, erased: true },
    ]) {
      expect(
        WEBHOOK_SCHEMAS["booking.cancelled"].safeParse({ ...sample, data: { session, booking: b } })
          .success,
      ).toBe(false);
    }
  });

  it("each type is its own contract: created, withdrawn, test", () => {
    const created = {
      ...sample,
      type: "booking.created",
      data: { session, booking: { ...booking, status: "booked", cancellation: undefined } },
    };
    expect(
      WEBHOOK_SCHEMAS["booking.created"].safeParse(JSON.parse(JSON.stringify(created))).success,
    ).toBe(true);
    // A booking.cancelled body is not a booking.created one.
    expect(WEBHOOK_SCHEMAS["booking.created"].safeParse(sample).success).toBe(false);
    const withdrawn = {
      ...sample,
      type: "strike.withdrawn",
      data: {
        session,
        booking: {
          ...booking,
          cancellation: {
            ...booking.cancellation,
            strike: { status: "withdrawn", live_strikes: 1 },
          },
        },
      },
    };
    expect(WEBHOOK_SCHEMAS["strike.withdrawn"].safeParse(withdrawn).success).toBe(true);
    expect(
      WEBHOOK_SCHEMAS["strike.withdrawn"].safeParse({ ...withdrawn, data: sample.data }).success,
    ).toBe(false);
    const ping = { ...sample, type: "test.ping", data: { message: TEST_PING_MESSAGE } };
    expect(WEBHOOK_SCHEMAS["test.ping"].parse(ping)).toEqual(ping);
  });
});

describe("the guide prints the contract", () => {
  it("docs/integrations.md holds the schemas exactly as the code has them", () => {
    const code = readFileSync("src/lib/integrations/webhooks.ts", "utf8");
    const start = code.indexOf("// ---- The contract");
    const end = code.indexOf("// ---- End of the contract ----");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = code.slice(start, end + "// ---- End of the contract ----".length);
    expect(block).toContain("WEBHOOK_SCHEMAS");
    expect(readFileSync("docs/integrations.md", "utf8")).toContain(block);
  });
});

describe("the queue's payload and the stored setting", () => {
  it("ids only: one log entry or one test, its key naming it", () => {
    const firmId = FIRM_A;
    expect(
      webhookDeliverPayload.safeParse({ firmId, idempotencyKey: "webhook:log:16", logEntryId: 42 })
        .success,
    ).toBe(true); // 42 in base 36
    for (const bad of [
      { firmId, idempotencyKey: "webhook:log:42", logEntryId: 42 },
      { firmId, idempotencyKey: "webhook:log:16" },
      {
        firmId,
        idempotencyKey: "webhook:log:16",
        logEntryId: 42,
        testId: "6f1c0e2a-0000-4000-8000-000000000042",
      },
    ]) {
      expect(webhookDeliverPayload.safeParse(bad).success).toBe(false);
    }
    // Anything else is dropped before it's queued (sendFirmJob queues the parsed payload).
    const parsed = webhookDeliverPayload.parse({
      firmId,
      idempotencyKey: "webhook:log:16",
      logEntryId: 42,
      url: "https://hooks.example/x",
    });
    expect(parsed).toEqual({ firmId, idempotencyKey: "webhook:log:16", logEntryId: 42 });
  });

  it("reads the address and version as stored, and nothing else", () => {
    expect(webhookOf({})).toEqual({ url: null, signingVersion: 0 });
    expect(webhookOf({ webhook: { url: "https://h.example/x", signing_version: 3 } })).toEqual({
      url: "https://h.example/x",
      signingVersion: 3,
    });
    expect(webhookOf({ webhook: { url: "http://h.example/x", signing_version: "3" } })).toEqual({
      url: null,
      signingVersion: 0,
    });
  });
});

describe("the worker's setting", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-session-secret-of-at-least-32-chars",
    APP_BASE_DOMAIN: "localhost:3000",
  };
  it("console by default; https refused under test; https required in production", () => {
    expect(parseWorkerEnv({ ...base, NODE_ENV: "development" }).WEBHOOK_TRANSPORT).toBe("console");
    expect(
      parseWorkerEnv({ ...base, NODE_ENV: "development", WEBHOOK_TRANSPORT: "" }).WEBHOOK_TRANSPORT,
    ).toBe("console");
    expect(() => parseWorkerEnv({ ...base, NODE_ENV: "test", WEBHOOK_TRANSPORT: "https" })).toThrow(
      /WEBHOOK_TRANSPORT/,
    );
    expect(() =>
      parseWorkerEnv({ ...base, NODE_ENV: "production", WEBHOOK_TRANSPORT: "console" }),
    ).toThrow(/WEBHOOK_TRANSPORT/);
    expect(() =>
      parseWorkerEnv({ ...base, NODE_ENV: "development", WEBHOOK_TRANSPORT: "smtp" }),
    ).toThrow(/WEBHOOK_TRANSPORT/);
  });
  it("pinned to console for this test run", () => {
    expect(process.env.WEBHOOK_TRANSPORT).toBe("console");
  });
});

describe("the new log entries", () => {
  const samples: [string, Record<string, unknown>][] = [
    [
      "firm.settings_changed",
      {
        by: "firm",
        keys: ["webhook.url", "webhook.signing_version"],
        webhook: "added",
        from: { "webhook.signing_version": 0 },
        to: { "webhook.signing_version": 1 },
      },
    ],
    [
      "firm.settings_changed",
      {
        by: "firm",
        keys: ["webhook.signing_version"],
        webhook: "new_secret",
        from: { "webhook.signing_version": 1 },
        to: { "webhook.signing_version": 2 },
      },
    ],
    [
      "webhook.delivered",
      {
        eventRef: webhookEventId(SECRET, FIRM_A, 7),
        bookingId: "b71e0c42-0000-4000-8000-000000000001",
        type: "booking.cancelled",
      },
    ],
    [
      "webhook.failed",
      {
        eventRef: webhookEventId(SECRET, FIRM_A, 8),
        bookingId: "b71e0c42-0000-4000-8000-000000000001",
        type: "booking.created",
        code: "http_500",
      },
    ],
    ["webhook.delivered", { eventRef: testEventId(SECRET, FIRM_A, FIRM_B), type: "test.ping" }],
  ];

  it.each(samples)("%s passes the log check and has plain words", (action, data) => {
    expect(passesLogCheck(data)).toBe(true);
    const words = eventWords(
      { action, actorType: "office", actorId: "o", data },
      { worker: () => "Ann Booker", office: () => "Sam Rota", credential: () => "x" },
    );
    expect(words).toMatch(/planner|webhook/);
    expect(words).not.toMatch(/hooks\.example|whsec_|evt_/);
  });
});
