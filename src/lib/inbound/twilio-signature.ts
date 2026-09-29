import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio's webhook signature (X-Twilio-Signature): HMAC-SHA1, keyed with the account's auth token,
// of the full URL Twilio called followed by every POST field's name and value, sorted by name,
// then base64. Twilio's documented example is reproduced in tests/unit/inbound.signature.test.ts.

export function twilioSignature(
  authToken: string,
  url: string,
  fields: Readonly<Record<string, string>>,
): string {
  const data =
    url +
    Object.keys(fields)
      .sort()
      .map((name) => `${name}${fields[name]}`)
      .join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

// In constant time, so a guess can't be refined by timing the answer.
export function isValidTwilioSignature(
  authToken: string,
  url: string,
  fields: Readonly<Record<string, string>>,
  header: string | null,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, fields));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
