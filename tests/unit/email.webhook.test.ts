import { describe, expect, it } from "vitest";
import type { FirmDirectoryEntry } from "@/lib/db/directory";
import type { InboundEmail } from "@/lib/email/receive";
import {
  handleEmailWebhook,
  MAX_EMAIL_WEBHOOK_BYTES,
  type EmailWebhookDeps,
} from "@/lib/email/webhook";
import { signedHeaders } from "@/lib/integrations/sign";
import { parseAppEnv } from "@/lib/env";
import type { Logger } from "@/lib/log";

// The staffing inbox's webhook in (P7.2; src/lib/email/webhook.ts): the signature first, nothing
// read before it passes; the firm by the address it was sent to; nothing of the email logged.
// Made-up secrets, people and addresses only.

const KEY = Buffer.from("made-up-inbound-signing-key-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;
const FIRM: FirmDirectoryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "acme",
  name: "Acme",
  timezone: "Europe/London",
  signOff: "Acme Shift Team",
};
const INBOX = "staffing-acme@inbound.example.test";
const OTHER_FIRM: FirmDirectoryEntry = { ...FIRM, id: "22222222-2222-4222-8222-222222222222" };
const OTHER_INBOX = "staffing-northline@inbound.example.test";
const NOW = new Date("2026-11-02T09:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function harness(o: { secret?: string | undefined } = {}) {
  const looked: string[] = [];
  const received: { firmId: string; email: InboundEmail }[] = [];
  const logged: { msg: string; fields: Record<string, unknown> }[] = [];
  const note = (msg: string, fields: Record<string, unknown> = {}) => logged.push({ msg, fields });
  const logger = { info: note, warn: note, error: note } as unknown as Logger;
  const deps: EmailWebhookDeps = {
    secret: "secret" in o ? o.secret : SECRET,
    resolveFirmByInbox: async (address) => {
      looked.push(address);
      return address === INBOX ? FIRM : address === OTHER_INBOX ? OTHER_FIRM : null;
    },
    receive: async (firmId, email) => {
      received.push({ firmId, email });
      return { stored: true };
    },
    now: () => NOW,
    logger,
  };
  return { deps, looked, received, logged };
}

const email = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    message_id: "<0001@mail.example.test>",
    from: "Ann Example <Ann.Example@example.com>",
    authenticated: true,
    to: [INBOX],
    subject: "Saturday",
    text: "Can I swap Saturday?",
    attachments: [{ filename: "note.pdf", size: 1200 }],
    ...o,
  });

const signed = (
  body: string,
  o: { at?: number; key?: Buffer; headers?: Record<string, string> } = {},
) =>
  new Request("https://shiftdesk.example/api/webhooks/email", {
    method: "POST",
    headers: { ...signedHeaders(o.key ?? KEY, "msg_0001", o.at ?? nowSeconds, body), ...o.headers },
    body,
  });

describe("the staffing inbox's webhook", () => {
  it("a signed email to a firm's inbox: stored for that firm, the addresses checked, only how many attachments", async () => {
    const h = harness();
    const r = await handleEmailWebhook(signed(email()), h.deps);
    expect(r.status).toBe(200);
    expect(h.received).toEqual([
      {
        firmId: FIRM.id,
        email: {
          messageId: "<0001@mail.example.test>",
          from: "ann.example@example.com",
          authenticated: true,
          to: INBOX,
          subject: "Saturday",
          text: "Can I swap Saturday?",
          attachments: 1,
        },
      },
    ]);
    // Nothing of the email in the log: no address, subject or words.
    expect(JSON.stringify(h.logged)).not.toMatch(/ann|saturday|swap|inbound\.example/i);
  });

  it("sent to several addresses: a row for each firm whose inbox it was sent to, once each", async () => {
    const h = harness();
    await handleEmailWebhook(
      signed(
        email({
          to: ["office@acme.example.com", `Staffing <${INBOX.toUpperCase()}>`, OTHER_INBOX, INBOX],
        }),
      ),
      h.deps,
    );
    expect(h.received.map((r) => [r.firmId, r.email.to])).toEqual([
      [FIRM.id, INBOX],
      [OTHER_FIRM.id, OTHER_INBOX],
    ]);
  });

  it("the provider's word on the sender carried; without it, not authenticated", async () => {
    const h = harness();
    await handleEmailWebhook(signed(email({ authenticated: undefined })), h.deps);
    await handleEmailWebhook(signed(email({ authenticated: "yes" })), h.deps);
    expect(h.received.map((r) => r.email.authenticated)).toEqual([false]);
  });

  it("a Message-ID missing or unusable: a stand-in the same email repeats; long words cut later, never refused", async () => {
    const h = harness();
    await handleEmailWebhook(signed(email({ message_id: undefined })), h.deps);
    await handleEmailWebhook(signed(email({ message_id: "has spaces in it" })), h.deps);
    await handleEmailWebhook(signed(email({ message_id: "has spaces in it" })), h.deps);
    const ids = h.received.map((r) => r.email.messageId);
    expect(ids[0]).toBe("webhook:msg_0001");
    expect(ids[1]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ids[2]).toBe(ids[1]);
    const long = "word ".repeat(40_000); // 200,000 characters each: far past what's kept, under the body cap
    expect(
      (await handleEmailWebhook(signed(email({ text: long, subject: long })), h.deps)).status,
    ).toBe(200);
  });

  it("no secret set: 503, nothing read", async () => {
    const h = harness({ secret: undefined });
    expect((await handleEmailWebhook(signed(email()), h.deps)).status).toBe(503);
    expect(h.looked).toEqual([]);
  });

  it("a missing, wrong or stale signature: 403, nothing looked up or stored", async () => {
    const h = harness();
    const body = email();
    const unsigned = new Request("https://shiftdesk.example/api/webhooks/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    for (const request of [
      unsigned,
      signed(body, { key: Buffer.from("another-made-up-key-0123456789abcdef") }),
      signed(body, { at: nowSeconds - 6 * 60 }),
      signed(body, { headers: { "webhook-id": "not an id!" } }),
    ]) {
      expect((await handleEmailWebhook(request, h.deps)).status).toBe(403);
    }
    // The body changed after signing.
    const tampered = new Request("https://shiftdesk.example/api/webhooks/email", {
      method: "POST",
      headers: { ...signedHeaders(KEY, "msg_0001", nowSeconds, body) },
      body: email({ text: "Something else" }),
    });
    expect((await handleEmailWebhook(tampered, h.deps)).status).toBe(403);
    expect(h.looked).toEqual([]);
    expect(h.received).toEqual([]);
  });

  it("not JSON 415, too big 413, not UTF-8 400, not an email 400 (field names logged, never values)", async () => {
    const h = harness();
    const form = signed(email(), { headers: { "content-type": "text/plain" } });
    expect((await handleEmailWebhook(form, h.deps)).status).toBe(415);
    const big = email({ text: "x".repeat(MAX_EMAIL_WEBHOOK_BYTES) });
    expect((await handleEmailWebhook(signed(big), h.deps)).status).toBe(413);
    const bytes = new Uint8Array([0x7b, 0xff, 0x7d]);
    const latin = new Request("https://shiftdesk.example/api/webhooks/email", {
      method: "POST",
      headers: { ...signedHeaders(KEY, "msg_0001", nowSeconds, "{\uFFFD}") },
      body: bytes,
    });
    expect((await handleEmailWebhook(latin, h.deps)).status).toBe(400);
    const noFrom = email({ from: 42 });
    expect((await handleEmailWebhook(signed(noFrom), h.deps)).status).toBe(400);
    expect(h.logged.at(-1)).toEqual({
      msg: "email webhook: a body that isn't an email",
      fields: { fields: ["from"] },
    });
    expect(h.received).toEqual([]);
  });

  it("sent to no firm's inbox, or from an address that can't be read: 200, nothing stored", async () => {
    const h = harness();
    expect(
      (await handleEmailWebhook(signed(email({ to: "someone@example.com" })), h.deps)).status,
    ).toBe(200);
    expect(
      (await handleEmailWebhook(signed(email({ from: "not an address" })), h.deps)).status,
    ).toBe(200);
    expect(h.received).toEqual([]);
  });
});

describe("the inbox's setting", () => {
  const base = {
    DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
    SESSION_SECRET: "a-made-up-session-secret-0123456789abcd",
    APP_BASE_DOMAIN: "localhost:3000",
  };
  const refusal = (source: Record<string, string>) => {
    try {
      parseAppEnv({ ...base, ...source });
      return "accepted";
    } catch (err) {
      return String((err as Error).message);
    }
  };

  it("a whsec_ key; in production too, now that its emails are sorted (P7.4; Phase 25.5)", () => {
    expect(refusal({ NODE_ENV: "development", EMAIL_INBOUND_SECRET: SECRET })).toBe("accepted");
    expect(refusal({ NODE_ENV: "development", EMAIL_INBOUND_SECRET: "not-a-key" })).toMatch(
      /whsec_/,
    );
    expect(refusal({ NODE_ENV: "production", EMAIL_INBOUND_SECRET: SECRET })).toBe("accepted");
  });
});
