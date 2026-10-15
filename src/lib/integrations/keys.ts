import { hashToken, looksLikeToken, newToken } from "../auth/tokens";

// The planner's API keys (12J.1; docs/office-v2.md 5.3.2; ADR-022): `shiftdesk_` plus 43 random
// base64url characters (newToken()). Only the sha256 of the whole key and its last 4 characters
// are kept (api_keys); the key itself is shown once, when it's made, and never logged.

export const API_KEY_PREFIX = "shiftdesk_";
export const MAX_LIVE_KEYS = 10; // per firm
export const KEY_LABEL_MAX = 60;

export const newApiKey = (): string => `${API_KEY_PREFIX}${newToken()}`;

// The shape check before any look-up: a key of any other shape never reaches the database.
export const looksLikeApiKey = (value: string): boolean =>
  value.startsWith(API_KEY_PREFIX) && looksLikeToken(value.slice(API_KEY_PREFIX.length));

export const apiKeyHash = (key: string): Buffer => hashToken(key);

// The last 4 characters, shown as "…k3F9" so an admin can tell keys apart.
export const apiKeyHint = (key: string): string => key.slice(-4);

// The key from an `Authorization: Bearer <key>` header (null: none, or not a Bearer one).
export function bearerKey(header: string | null): string | null {
  if (!header) return null;
  // The scheme name is case-insensitive in HTTP (RFC 7235 2.1): "bearer" works too.
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return m?.[1] ?? null;
}
