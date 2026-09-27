import { createHash, randomBytes } from "node:crypto";

// Login links and session cookies carry 32 random bytes (base64url, 43 characters). Only the
// sha256 of a token is ever stored, so a database leak can't be replayed as a login.

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

// Cheap shape check before any database work: anything else can't be one of our tokens.
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
