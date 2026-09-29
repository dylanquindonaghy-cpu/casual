import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { errorCode } from "../jobs/firm-job";
import { log } from "../log";
import { appPool, assertSafeAppConnection, drizzleFor } from "./pool";

// Is the web app able to serve? (GET /api/health: Docker's health check and the uptime check.)
// Yes when it reaches the database as the app role within 3 seconds. The answer says nothing more
// than ok or not: no versions, no hosts, no error text (it's public).
export async function webHealthy(pool: Pool = appPool(), timeoutMs = 3000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await assertSafeAppConnection(pool);
        await drizzleFor(pool).execute(sql`select 1`);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch (err) {
    log.error("health: the database isn't reachable", { code: errorCode(err) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The public endpoint's answer, reused for a few seconds and never asked twice at once: anyone
// can call /api/health, and each real check uses a database connection real requests need.
export function createHealthCache(
  check: () => Promise<boolean>,
  ttlMs = 5000,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let last: { at: number; ok: boolean } | undefined;
  let inFlight: Promise<boolean> | undefined;
  return () => {
    if (last && now() - last.at < ttlMs) return Promise.resolve(last.ok);
    inFlight ??= check()
      .then((ok) => {
        last = { at: now(), ok };
        return ok;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

let cached: (() => Promise<boolean>) | undefined;

export function webHealth(): Promise<boolean> {
  cached ??= createHealthCache(() => webHealthy());
  return cached();
}
