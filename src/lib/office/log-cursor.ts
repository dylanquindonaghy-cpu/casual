import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// The action log's "Older" link (Phase 10, audit L44). Events are numbered by one counter shared by
// every firm, so showing the number of the last line on a page would let a firm count the events
// other firms wrote in between: a rough measure of a competitor's activity. The link carries the
// number encrypted instead (AES-256-GCM, with a key derived from SESSION_SECRET for this use only),
// bound to the firm: it reads as random letters, and one made for another firm, or changed, is
// ignored (the first page).

const IV = 12;
const TAG = 16;
// 12 + 8 + 16 bytes: exactly 48 characters (no padding bits, so every character counts).
const CURSOR = /^[A-Za-z0-9_-]{48}$/;

const keyFor = (secret: string) =>
  Buffer.from(hkdfSync("sha256", secret, "", "shiftdesk action-log cursor v1", 32));

export function encodeLogCursor(eventId: number, firmId: string, secret: string): string {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(firmId));
  const id = Buffer.alloc(8);
  id.writeBigUInt64BE(BigInt(eventId));
  const sealed = Buffer.concat([cipher.update(id), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url");
}

// The event id, or null for anything that isn't a cursor this firm was given.
export function decodeLogCursor(cursor: string, firmId: string, secret: string): number | null {
  if (!CURSOR.test(cursor)) return null;
  const raw = Buffer.from(cursor, "base64url");
  if (raw.length !== IV + 8 + TAG) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, IV));
    decipher.setAAD(Buffer.from(firmId));
    decipher.setAuthTag(raw.subarray(IV + 8));
    const id = Buffer.concat([decipher.update(raw.subarray(IV, IV + 8)), decipher.final()]);
    const n = Number(id.readBigUInt64BE());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Whether text has a cursor's shape (checked again, fully, when it's read).
export const isLogCursor = (text: string) => CURSOR.test(text);
