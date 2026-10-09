import { createHmac, timingSafeEqual } from "node:crypto";

// One-time codes are only 6 digits, so a plain hash would be reversed in a moment by anyone who
// saw the table. They are stored as an HMAC keyed with SESSION_SECRET and bound to the session,
// so a code is worthless outside the session it was sent for.
export function codeHash(secret: string, sessionId: string, code: string): Buffer {
  return createHmac("sha256", secret).update(`otp:${sessionId}:${code}`).digest();
}

export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
