import { createHmac, timingSafeEqual } from "node:crypto";

// Standard Webhooks signing (https://www.standardwebhooks.com/; docs/office-v2.md 5.3.3; 12J.2),
// so a receiver can check a delivery with an existing library: the `v1,` signature is the base64
// HMAC-SHA256, keyed with the signing secret's bytes, of "{id}.{timestamp}.{body}". Receivers refuse
// a timestamp more than 5 minutes off and drop repeats by `webhook-id`.

export const WEBHOOK_USER_AGENT = "ShiftDesk-Webhooks/1";

export function signature(key: Buffer, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

export interface SignedHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
  "content-type": "application/json";
  "user-agent": typeof WEBHOOK_USER_AGENT;
}

// The headers for one try (its own timestamp, in Unix seconds).
export function signedHeaders(
  key: Buffer,
  id: string,
  timestamp: number,
  body: string,
): SignedHeaders {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signature(key, id, timestamp, body),
    "content-type": "application/json",
    "user-agent": WEBHOOK_USER_AGENT,
  };
}

export const TOLERANCE_SECONDS = 5 * 60;

// What a receiver does (docs/integrations.md prints the same steps): the timestamp within 5
// minutes, and any of the space-separated `v1,` signatures matching. For the tests and the guide.
export function verifySignature(
  key: Buffer,
  headers: { id: string; timestamp: string; signature: string },
  body: string,
  nowSeconds: number,
): boolean {
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signature(key, headers.id, ts, body));
  return headers.signature.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
