import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { appPool, assertSafeAppConnection, drizzleFor, type Db } from "./pool";

// The only way app code reaches firm data (golden rule 2).
//
// withFirm opens a transaction on the app role's pool and sets app.current_firm_id with
// set_config(..., true), which is SET LOCAL with a bound parameter. It ends at COMMIT/ROLLBACK,
// so a pooled connection never carries one firm's id into the next request. RLS policies on
// every table compare firm_id with that setting; when it's unset they match nothing.
//
// Rules for code inside fn: use only `tx`. Don't call withFirm again (a nested transaction is a
// savepoint, and a firm set inside it would leak into the outer one), so nesting throws.

export type FirmTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type WithFirm = <T>(firmId: string, fn: (tx: FirmTx) => Promise<T>) => Promise<T>;

export const firmIdSchema = z.uuid();

const active = new AsyncLocalStorage<{ firmId: string }>();

// The firm of the enclosing withFirm call, if any. sendFirmJob uses it so a caller can never
// queue a job for a different firm.
export function activeFirmId(): string | undefined {
  return active.getStore()?.firmId;
}

// Builds a withFirm bound to a pool. App code uses the default `withFirm` below; tests use this
// to control the pool size.
export function createWithFirm(pool: Pool): WithFirm {
  const db = drizzleFor(pool);
  let ready: Promise<void> | undefined;

  return async (firmId, fn) => {
    if (active.getStore()) {
      throw new Error("withFirm cannot be nested. Use the tx you already have.");
    }
    const id = firmIdSchema.parse(firmId);
    ready ??= assertSafeAppConnection(pool).catch((err: unknown) => {
      ready = undefined; // try again next time (e.g. the database was briefly down)
      throw err;
    });
    await ready;
    return active.run({ firmId: id }, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_firm_id', ${id}, true)`);
        return fn(tx);
      }),
    );
  };
}

let defaultWithFirm: WithFirm | undefined;

export function withFirm<T>(firmId: string, fn: (tx: FirmTx) => Promise<T>): Promise<T> {
  defaultWithFirm ??= createWithFirm(appPool());
  return defaultWithFirm(firmId, fn);
}
