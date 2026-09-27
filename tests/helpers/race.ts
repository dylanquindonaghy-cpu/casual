import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { createWithFirm, type FirmTx } from "@/lib/db/scoped";
import { urls } from "./db";

// Runs `statement` in n transactions at the same moment. Every transaction first opens, sets its
// firm and waits at a barrier; only when all n are inside do they run the statement. Without the
// barrier, a pool that connects lazily runs them one after another, and a read-then-write bug
// passes a "10 at once" test every time.
export async function race<T>(
  n: number,
  firmId: string,
  statement: (tx: FirmTx) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const pool = new Pool({ connectionString: urls.app, max: n });
  try {
    const withFirm = createWithFirm(pool);
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const timeout = setTimeout(release, 10_000); // never hang a test run
    const results = await Promise.allSettled(
      Array.from({ length: n }, () =>
        withFirm(firmId, async (tx) => {
          await tx.execute(sql`select 1`);
          arrived += 1;
          if (arrived === n) release();
          await gate;
          return statement(tx);
        }),
      ),
    );
    clearTimeout(timeout);
    return results;
  } finally {
    await pool.end();
  }
}

export const fulfilled = <T>(results: PromiseSettledResult<T>[]): T[] =>
  results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

// A second meeting point inside racing transactions: each caller waits until n have arrived.
// For races where the order of two steps matters (all spend, then all retire).
export function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const all = new Promise<void>((resolve) => (release = resolve));
  const timeout = setTimeout(release, 10_000);
  return async () => {
    arrived += 1;
    if (arrived === n) {
      clearTimeout(timeout);
      release();
    }
    await all;
  };
}
