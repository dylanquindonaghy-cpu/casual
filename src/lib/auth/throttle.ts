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
  // Login links: 3 per number every 15 minutes and 10 per number a day (Phase 10, audit L49: 3
  // every 15 minutes alone allowed 288 messages a day to one number, each billed to the firm), and
  // 60 per IP every 15 minutes: a team briefed on one venue's Wi-Fi shares one address, so 10 left
  // most of them out (Dylan, 2026-10-16; 13.5). The per-number limits are what stop one number
  // being flooded; the IP limit is easy to spread anyway. Each link costs a message.
  loginPerNumber: { name: "login:mobile", max: 3, windowMs: 15 * MINUTE },
  loginPerNumberDaily: { name: "login:mobile_day", max: 10, windowMs: 24 * 60 * MINUTE },
  loginPerIp: { name: "login:ip", max: 60, windowMs: 15 * MINUTE },
  // Using links: 20 failed attempts (expired, used, junk) per IP. Successful logins don't count,
  // so a whole crew logging in on one venue Wi-Fi isn't locked out by its own success.
  linkFailuresPerIp: { name: "link_fail:ip", max: 20, windowMs: 15 * MINUTE },
  // Office login links by email: 3 per address and 10 per IP every 15 minutes, and 10 per address
  // a day (audit L49).
  officeLoginPerEmail: { name: "office:email", max: 3, windowMs: 15 * MINUTE },
  officeLoginPerEmailDaily: { name: "office:email_day", max: 10, windowMs: 24 * 60 * MINUTE },
  officeLoginPerIp: { name: "office:ip", max: 10, windowMs: 15 * MINUTE },
  // Pay-page codes: 3 per worker every 15 minutes and 10 a day (each costs a message and gives
  // 5 guesses, so the daily cap bounds guessing over a long, noisy attack).
  codePerWorker: { name: "otp:worker", max: 3, windowMs: 15 * MINUTE },
  codePerWorkerDaily: { name: "otp:worker_day", max: 10, windowMs: 24 * 60 * MINUTE },
  // The planner API (12J.1; docs/office-v2.md 5.3.2): 300 calls a minute per key, counted by the
  // key's id. Its answer gives the wait in seconds (Retry-After).
  apiPerKey: { name: "api:key", max: 300, windowMs: MINUTE },
  // A phone's push subscription saved (POST /api/push/subscribe; 13.3): 10 per worker every 15
  // minutes, counted by the worker's id, only for a save that writes (and so logs). Turning
  // notifications on, or the browser renewing a subscription, takes one. Removing is never limited.
  pushPerWorker: { name: "push:worker", max: 10, windowMs: 15 * MINUTE },
  // "Take shift" (13.5; Checks 6): 20 taps per worker every 15 minutes, counted by the worker's id,
  // booked or not. Plenty for anyone picking up shifts; it stops one session hammering the rules
  // and the action log (every refused tap logs shift.booking_refused).
  takePerWorker: { name: "take:worker", max: 20, windowMs: 15 * MINUTE },
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

export type Throttled = { retryAfterMinutes: number; retryAfterSeconds: number; limit: string };

export const toMinutes = (ms: number) => Math.max(1, Math.ceil(ms / MINUTE));

// Logged once per window: when a limit is first reached, not on every refused attempt, so a
// flood of refusals can't flood the (append-only, kept a year) action log. `entityId` names what
// reached it when that's known and safe to keep (the planner's key id; never a number or email).
export async function logLimitReached(
  tx: FirmTx,
  limit: Limit,
  entityType: string,
  entityId?: string,
): Promise<void> {
  await recordEvent(tx, {
    actorType: "system",
    action: "auth.rate_limited",
    entityType,
    entityId: entityId ?? null,
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
  opts: { now: Date; secret: string; entityType: string; entityId?: string },
): Promise<Throttled | null> {
  return run(firmId, async (tx) => {
    for (const check of checks) {
      const hit = await hitLimit(tx, { ...check, now: opts.now, secret: opts.secret });
      if (hit.allowed) continue;
      if (hit.hits === hit.limit.max + 1)
        await logLimitReached(tx, hit.limit, opts.entityType, opts.entityId);
      return {
        retryAfterMinutes: toMinutes(hit.retryAfterMs),
        retryAfterSeconds: Math.max(1, Math.ceil(hit.retryAfterMs / 1000)),
        limit: hit.limit.name,
      };
    }
    return null;
  });
}
