import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { activeFirmId, type FirmTx, type WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { MINUTE } from "./clock";

// Rate limits for login (docs/architecture.md, Login). Fixed windows counted in auth_throttle,
// one row per bucket per window. The bucket is an HMAC of the number, email or IP (keyed with
// SESSION_SECRET), never the value itself. Counts are per firm (the table is firm-scoped), so
// one IP gets these limits on each firm's portal separately.

export interface Limit {
  name: string;
  max: number;
  windowMs: number;
}

export const LIMITS = {
  // Login links: 3 per number and 10 per IP every 15 minutes. Each link costs a message.
  loginPerNumber: { name: "login:mobile", max: 3, windowMs: 15 * MINUTE },
  loginPerIp: { name: "login:ip", max: 10, windowMs: 15 * MINUTE },
  // Using links: 20 failed attempts (expired, used, junk) per IP. Successful logins don't count,
  // so a whole crew logging in on one venue Wi-Fi isn't locked out by its own success.
  linkFailuresPerIp: { name: "link_fail:ip", max: 20, windowMs: 15 * MINUTE },
  // Office login links by email: 3 per address and 10 per IP every 15 minutes.
  officeLoginPerEmail: { name: "office:email", max: 3, windowMs: 15 * MINUTE },
  officeLoginPerIp: { name: "office:ip", max: 10, windowMs: 15 * MINUTE },
  // Pay-page codes: 3 per worker every 15 minutes and 10 a day (each costs a message and gives
  // 5 guesses, so the daily cap bounds guessing over a long, noisy attack).
  codePerWorker: { name: "otp:worker", max: 3, windowMs: 15 * MINUTE },
  codePerWorkerDaily: { name: "otp:worker_day", max: 10, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, Limit>;

export function bucketFor(limit: Limit, value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(`${limit.name}\0${value}`).digest("base64url");
  return `${limit.name}:${mac.slice(0, 32)}`;
}

const windowOf = (limit: Limit, now: Date) =>
  new Date(Math.floor(now.getTime() / limit.windowMs) * limit.windowMs);

export interface Hit {
  limit: Limit;
  hits: number;
  allowed: boolean;
  retryAfterMs: number;
}

// Counts one attempt. One statement (insert, or add one on conflict), so parallel requests can't
// lose a count.
export async function hitLimit(
  tx: FirmTx,
  opts: { limit: Limit; value: string; now: Date; secret: string },
): Promise<Hit> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("hitLimit must be called inside withFirm");
  const { limit, now } = opts;
  const windowStart = windowOf(limit, now);
  const { rows } = await tx.execute<{ hits: number }>(sql`
    insert into auth_throttle (firm_id, bucket, window_start, hits)
    values (${firmId}, ${bucketFor(limit, opts.value, opts.secret)}, ${windowStart}, 1)
    on conflict (firm_id, bucket, window_start) do update set hits = auth_throttle.hits + 1
    returning hits
  `);
  const hits = Number(rows[0]?.hits ?? Number.POSITIVE_INFINITY);
  return {
    limit,
    hits,
    allowed: hits <= limit.max,
    retryAfterMs: windowStart.getTime() + limit.windowMs - now.getTime(),
  };
}

// The current count, without adding to it.
export async function peekLimit(
  tx: FirmTx,
  opts: { limit: Limit; value: string; now: Date; secret: string },
): Promise<Hit> {
  const { limit, now } = opts;
  const windowStart = windowOf(limit, now);
  const { rows } = await tx.execute<{ hits: number }>(sql`
    select hits from auth_throttle
     where bucket = ${bucketFor(limit, opts.value, opts.secret)} and window_start = ${windowStart}
  `);
  const hits = Number(rows[0]?.hits ?? 0);
  return {
    limit,
    hits,
    allowed: hits < limit.max,
    retryAfterMs: windowStart.getTime() + limit.windowMs - now.getTime(),
  };
}

export type Throttled = { retryAfterMinutes: number; limit: string };

export const toMinutes = (ms: number) => Math.max(1, Math.ceil(ms / MINUTE));

// Logged once per window: when a limit is first reached, not on every refused attempt, so a
// flood of refusals can't flood the (append-only, kept a year) action log.
export async function logLimitReached(tx: FirmTx, limit: Limit, entityType: string): Promise<void> {
  await recordEvent(tx, {
    actorType: "system",
    action: "auth.rate_limited",
    entityType,
    data: { limit: limit.name },
  });
}

// Counts the checks in order, in their own short transaction committed before the real work
// (so a request that later fails still counts), and stops at the first refusal: a refused
// request never counts against a later limit. Order matters: IP first, so an IP that is already
// refused can't use up a worker's per-number allowance (and lock them out) without a single
// link being sent. Returns null if every check is within its limit.
export async function throttle(
  run: WithFirm,
  firmId: string,
  checks: { limit: Limit; value: string }[],
  opts: { now: Date; secret: string; entityType: string },
): Promise<Throttled | null> {
  return run(firmId, async (tx) => {
    for (const check of checks) {
      const hit = await hitLimit(tx, { ...check, now: opts.now, secret: opts.secret });
      if (hit.allowed) continue;
      if (hit.hits === hit.limit.max + 1) await logLimitReached(tx, hit.limit, opts.entityType);
      return { retryAfterMinutes: toMinutes(hit.retryAfterMs), limit: hit.limit.name };
    }
    return null;
  });
}
