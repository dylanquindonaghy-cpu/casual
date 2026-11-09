// A salted scrypt hash as the staffing demo login keeps it (Phase 31.1;
// src/lib/demo/staff-login.ts): "scrypt$N$r$p$salt$key", the salt and key in base64url. Its own small
// module, with no imports, so the settings check (src/lib/env.ts, DEMO_STAFF_LOGIN_HASH) refuses at
// startup exactly the hashes the login would refuse.

export interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

// Refuses a cost that isn't a power of two from 2^14 to 2^17 (and r outside 1-16, p outside 1-4),
// so a bad setting can't make each try slow down the server or check nothing.
export function parseScryptHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map((x) => Number(x)) as [number, number, number];
  const okN = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 17 && (N & (N - 1)) === 0;
  if (!okN || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4)
    return null;
  const b64 = /^[A-Za-z0-9_-]+$/;
  if (!b64.test(parts[4] ?? "") || !b64.test(parts[5] ?? "")) return null;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const key = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length < 16 || key.length < 32) return null;
  return { N, r, p, salt, key };
}
