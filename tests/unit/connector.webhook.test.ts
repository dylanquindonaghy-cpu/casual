import { describe, expect, it } from "vitest";
import { connectorWebhookKey, connectorWebhookSecret } from "@/lib/connector/webhook-secret";
import {
  handleConnectorWebhook,
  MAX_CONNECTOR_WEBHOOK_BYTES,
  type ConnectorEventIn,
  type ConnectorWebhookDeps,
} from "@/lib/connector/webhook";
import { keyFromSigningSecret, signingSecret } from "@/lib/integrations/secrets";
import { signedHeaders } from "@/lib/integrations/sign";
import type { Logger } from "@/lib/log";

// A connector's webhooks in (P5.3; src/lib/connector/webhook.ts): the signature first, nothing read
// before it passes; then the body names what changed, and nothing else in it is taken. Made-up
// secrets and ids only.

const SECRET = "test-only-integrations-secret-0123456789abcdef";
const SOURCE = "6b1f6c0e-3c8a-4b0e-9d6a-2f1e0c9b8a71";
const FIRM = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-02T09:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function harness(o: { secret?: string | undefined; source?: { firmId: string } | null } = {}) {
  const resolved: string[] = [];
  const received: { firmId: string; event: ConnectorEventIn }[] = [];
  const warnings: { msg: string; fields: Record<string, unknown> }[] = [];
  const logger = {
    info: () => undefined,
    warn: (msg: string, fields: Record<string, unknown> = {}) => warnings.push({ msg, fields }),
    error: () => undefined,
  } as unknown as Logger;
  const deps: ConnectorWebhookDeps = {
    secret: "secret" in o ? o.secret : SECRET,
    resolveSource: async (id) => {
      resolved.push(id);
      return o.source === undefined ? { firmId: FIRM } : o.source;
    },
    receive: async (firmId, event) => {
      received.push({ firmId, event });
      return { stored: true };
    },
    now: () => NOW,
    logger,
  };
  return { deps, resolved, received, warnings };
}

const signed = (
  body: string,
  o: {
    id?: string;
    at?: number;
    key?: Buffer;
    source?: string;
    headers?: Record<string, string>;
  } = {},
) =>
  new Request(`https://shiftdesk.example/api/webhooks/connector/${o.source ?? SOURCE}`, {
    method: "POST",
    headers: {
      ...signedHeaders(
        o.key ?? connectorWebhookKey(SECRET, o.source ?? SOURCE),
        o.id ?? "evt-0001",
        o.at ?? nowSeconds,
        body,
      ),
      ...o.headers,
    },
    body,
  });

const CHANGE = JSON.stringify({ type: "session.changed", ref: "PORTAL-S1" });

describe("the connector's webhook secret", () => {
  it("is ours, worked out from INTEGRATIONS_SECRET and the source, the Standard Webhooks form", () => {
    const whsec = connectorWebhookSecret(SECRET, SOURCE);
    expect(whsec).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(keyFromSigningSecret(whsec).equals(connectorWebhookKey(SECRET, SOURCE))).toBe(true);
    expect(connectorWebhookSecret(SECRET, SOURCE.toUpperCase())).toBe(whsec);
    // Another source, another secret, or the planner's own webhook secret: never the same.
    expect(connectorWebhookSecret(SECRET, "7b1f6c0e-3c8a-4b0e-9d6a-2f1e0c9b8a71")).not.toBe(whsec);
    expect(connectorWebhookSecret(`${SECRET}x`, SOURCE)).not.toBe(whsec);
    expect(signingSecret(SECRET, SOURCE, 1)).not.toBe(whsec);
  });
});

describe("POST /api/webhooks/connector/{source id}", () => {
  it("a signed change: its firm found, one event passed on with only its type and ref, 200", async () => {
    const h = harness();
    const body = JSON.stringify({
      type: "session.changed",
      ref: "PORTAL-S1",
      // Nothing else in the body is taken: the job reads the record from the source.
      places: 99,
      role: "manager",
    });
    const r = await handleConnectorWebhook(signed(body), SOURCE, h.deps);
    expect(r.status).toBe(200);
    expect(h.resolved).toEqual([SOURCE]);
    expect(h.received).toEqual([
      {
        firmId: FIRM,
        event: { sourceId: SOURCE, eventId: "evt-0001", type: "session.changed", ref: "PORTAL-S1" },
      },
    ]);
  });

  it("a missing, wrong or old signature: 403, and nothing is read or stored", async () => {
    const otherKey = connectorWebhookKey(SECRET, "7b1f6c0e-3c8a-4b0e-9d6a-2f1e0c9b8a71");
    for (const request of [
      new Request(`https://shiftdesk.example/api/webhooks/connector/${SOURCE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: CHANGE,
      }),
      signed(CHANGE, { key: otherKey }), // another source's secret
      signed(CHANGE, { at: nowSeconds - 6 * 60 }), // over 5 minutes old
      signed(CHANGE, { headers: { "webhook-id": "evt-0002" } }), // the id changed after signing
      signed(CHANGE, { id: "not an id" }),
    ]) {
      const h = harness();
      const r = await handleConnectorWebhook(request, SOURCE, h.deps);
      expect(r.status).toBe(403);
      expect(h.resolved).toEqual([]);
      expect(h.received).toEqual([]);
    }
    // A body changed after signing.
    const h = harness();
    const tampered = signed(CHANGE);
    const r = await handleConnectorWebhook(
      new Request(tampered.url, {
        method: "POST",
        headers: tampered.headers,
        body: JSON.stringify({ type: "session.changed", ref: "PORTAL-S2" }),
      }),
      SOURCE,
      h.deps,
    );
    expect([r.status, h.received.length]).toEqual([403, 0]);
  });

  it("refuses what isn't one before checking it: not a source id 404, no secret 503, not JSON 415, too big 413", async () => {
    const cases: [Request, string, ReturnType<typeof harness>, number][] = [
      [signed(CHANGE), "not-a-uuid", harness(), 404],
      [signed(CHANGE), SOURCE, harness({ secret: undefined }), 503],
      [signed(CHANGE, { headers: { "content-type": "text/plain" } }), SOURCE, harness(), 415],
      [
        signed(
          JSON.stringify({
            type: "session.changed",
            ref: "R1",
            pad: "x".repeat(MAX_CONNECTOR_WEBHOOK_BYTES),
          }),
        ),
        SOURCE,
        harness(),
        413,
      ],
    ];
    for (const [request, source, h, status] of cases) {
      const r = await handleConnectorWebhook(request, source, h.deps);
      expect(r.status).toBe(status);
      expect(h.received).toEqual([]);
    }
  });

  it("a body sent in chunks with no length is read only up to 16 kB; bytes that aren't UTF-8 are 400", async () => {
    const big = new TextEncoder().encode("x".repeat(MAX_CONNECTOR_WEBHOOK_BYTES + 1));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 1 kB at a time, for ever: the reader must stop on its own.
        pulled += 1;
        controller.enqueue(big.subarray(0, 1024));
      },
    });
    const h = harness();
    const r = await handleConnectorWebhook(
      new Request(`https://shiftdesk.example/api/webhooks/connector/${SOURCE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      SOURCE,
      h.deps,
    );
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThan(40);
    const bad = harness();
    const notUtf8 = await handleConnectorWebhook(
      new Request(`https://shiftdesk.example/api/webhooks/connector/${SOURCE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      }),
      SOURCE,
      bad.deps,
    );
    expect([notUtf8.status, bad.resolved, bad.received]).toEqual([400, [], []]);
  });

  it("a signed body that isn't a change: 400, its field names logged, never its values", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ type: "session.deleted", ref: "PORTAL-S1" }),
      JSON.stringify({ type: "staff.changed", ref: "has spaces in it" }),
      JSON.stringify({ ref: "PORTAL-S1" }),
    ]) {
      const h = harness();
      const r = await handleConnectorWebhook(signed(body), SOURCE, h.deps);
      expect(r.status, body).toBe(400);
      expect(h.received).toEqual([]);
      expect(JSON.stringify(h.warnings)).not.toContain("has spaces");
    }
  });

  it("a source no firm has on: 200 and nothing stored (it needn't send it again)", async () => {
    const h = harness({ source: null });
    const r = await handleConnectorWebhook(signed(CHANGE), SOURCE, h.deps);
    expect([r.status, h.resolved, h.received]).toEqual([200, [SOURCE], []]);
  });
});
