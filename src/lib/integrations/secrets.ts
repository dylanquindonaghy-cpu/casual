import { createHmac } from "node:crypto";

// What the planner's webhooks are signed and named with (docs/office-v2.md 5.3.3; 12J.2), all
// derived from INTEGRATIONS_SECRET and never stored.
//
// - The signing secret: `whsec_` plus the base64 of HMAC-SHA256(INTEGRATIONS_SECRET,
//   "webhook|{firmId}|{signing_version}"), the Standard Webhooks form. It is shown to an admin once,
//   when the address is added or the secret renewed. app_set_firm_setting() raises the version on
//   each (the app can't set it), so an old secret stops at once and never comes back.
// - The event id: `evt_` plus 22 letters from an HMAC of the firm id and the action-log entry's id:
//   the same on every try (receivers drop repeats by it), different in every firm, and it never
//   shows the shared log's numbering. Letters only (base 52, about 125 bits), never digits: the
//   action log refuses any value with a run of 10 digits (it would be taken for a phone number),
//   and `webhook.delivered` carries the id.
// Rotating INTEGRATIONS_SECRET changes both: every firm with a webhook pastes its new secret
// (docs/runbooks.md).

export const SIGNING_SECRET_PREFIX = "whsec_";
export const EVENT_ID_PREFIX = "evt_";
const EVENT_ID_LETTERS = 22;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// The raw key bytes the signature is made with (what `whsec_…` encodes).
export function signingKey(secret: string, firmId: string, version: number): Buffer {
  return createHmac("sha256", secret).update(`webhook|${firmId.toLowerCase()}|${version}`).digest();
}

export const signingSecret = (secret: string, firmId: string, version: number): string =>
  `${SIGNING_SECRET_PREFIX}${signingKey(secret, firmId, version).toString("base64")}`;

// The key a `whsec_…` secret stands for (a receiver does the same).
export function keyFromSigningSecret(whsec: string): Buffer {
  if (!whsec.startsWith(SIGNING_SECRET_PREFIX)) throw new Error("not a signing secret");
  return Buffer.from(whsec.slice(SIGNING_SECRET_PREFIX.length), "base64");
}

// 22 letters from the HMAC's 256 bits, read as one number in base 52.
function letters(bytes: Buffer, n: number): string {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  const base = BigInt(LETTERS.length);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += LETTERS[Number(value % base)];
    value /= base;
  }
  return out;
}

const eventIdFrom = (secret: string, firmId: string, what: string): string =>
  `${EVENT_ID_PREFIX}${letters(
    createHmac("sha256", secret).update(`webhook-event|${firmId.toLowerCase()}|${what}`).digest(),
    EVENT_ID_LETTERS,
  )}`;

// A delivery's id, from the action-log entry it tells the planner about.
export const webhookEventId = (secret: string, firmId: string, logEntryId: number): string =>
  eventIdFrom(secret, firmId, `log:${logEntryId}`);

// A test event's id ("Send test event"), from the test's own random id.
export const testEventId = (secret: string, firmId: string, testId: string): string =>
  eventIdFrom(secret, firmId, `test:${testId.toLowerCase()}`);

export const EVENT_ID_PATTERN = /^evt_[A-Za-z]{22}$/;
