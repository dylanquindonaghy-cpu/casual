import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import {
  appPool,
  assertSafeAppConnection,
  dbProfile,
  drizzleFor,
  type Db,
  type DbLimits,
} from "./pool";

// The worker picks its profile here (src/worker can't import the pool itself: ESLint).
export { chooseDbProfile, type DbLimits } from "./pool";

// The only way app code reaches firm data (golden rule 2).
//
// withFirm opens a transaction on the app role's pool and sets app.current_firm_id with
// set_config(..., true), which is SET LOCAL with a bound parameter. It ends at COMMIT/ROLLBACK,
// so a pooled connection never carries one firm's id into the next request. RLS policies on
// every table compare firm_id with that setting; when it's unset they match nothing.
//
// Rules for code inside fn: use only `tx`. Don't call withFirm again (a nested transaction is a
// savepoint, and a firm set inside it would leak into the outer one), so nesting throws.
//
// The process's time limits (P4.2; ADR-027) are set in the same statement, the same way, so they
// end with the transaction too: a statement that runs longer fails (SQLSTATE 57014), and a
// transaction left idle longer ends its connection (25P03). The few that need longer say so with
// allowLonger() as their first statement.

export type FirmTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type WithFirm = <T>(firmId: string, fn: (tx: FirmTx) => Promise<T>) => Promise<T>;

export const firmIdSchema = z.uuid();

const active = new AsyncLocalStorage<{ firmId: string }>();

// The firm of the enclosing withFirm call, if any. sendFirmJob uses it so a caller can never
// queue a job for a different firm.
export function activeFirmId(): string | undefined {
  return active.getStore()?.firmId;
}

// How long withFirm waited for its connections, for the backlog alerts (P4.8): waits of a second
// or more, and waits that ran out. Counted since the last take.
export interface ConnectionWaits {
  slow: number;
  timedOut: number;
}
export const SLOW_CONNECTION_WAIT_MS = 1_000;

const ms = (n: number) => `${n}ms`;

// pg's own words when no connection came within connectionTimeoutMillis (pg-pool).
const isConnectTimeout = (err: unknown) =>
  err instanceof Error && /timeout exceeded when trying to connect/i.test(err.message);

// Builds a withFirm bound to a pool. App code uses the default `withFirm` below; tests use this
// to control the pool size, and the limits (none unless given).
export function createWithFirm(
  pool: Pool,
  opts: { limits?: DbLimits; waits?: ConnectionWaits } = {},
): WithFirm {
  const db = drizzleFor(pool);
  const { limits, waits } = opts;
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
    const asked = Date.now();
    try {
      return await active.run({ firmId: id }, () =>
        db.transaction(async (tx) => {
          if (waits && Date.now() - asked >= SLOW_CONNECTION_WAIT_MS) waits.slow += 1;
          await tx.execute(
            limits
              ? sql`select set_config('app.current_firm_id', ${id}, true),
                           set_config('statement_timeout', ${ms(limits.statementMs)}, true),
                           set_config('idle_in_transaction_session_timeout',
                                      ${ms(limits.idleInTransactionMs)}, true)`
              : sql`select set_config('app.current_firm_id', ${id}, true)`,
          );
          return fn(tx);
        }),
      );
    } catch (err) {
      if (waits && isConnectTimeout(err)) waits.timedOut += 1;
      throw err;
    }
  };
}

// The transactions that run long, or wait by design, and how long they may (ADR-027).
export const LONG_TRANSACTIONS = {
  // The credential scan's lock holder sits idle while the scan's messages go (scan.ts
  // oneScanAtATime): no idle limit, and its lock wait ends by its own 5-minute lock_timeout first.
  scanLockHolder: { statementMs: 6 * 60_000, idleInTransactionMs: 0 },
  firmExport: { statementMs: 2 * 60_000, idleInTransactionMs: 60_000 },
  retentionPurge: { statementMs: 10 * 60_000, idleInTransactionMs: 60_000 },
  metricsRollup: { statementMs: 5 * 60_000, idleInTransactionMs: 60_000 },
} as const satisfies Record<string, DbLimits>;

// Longer limits for this transaction only: its first statement (they end with it, like withFirm's).
export async function allowLonger(tx: FirmTx, limits: DbLimits): Promise<void> {
  await tx.execute(
    sql`select set_config('statement_timeout', ${ms(limits.statementMs)}, true),
               set_config('idle_in_transaction_session_timeout',
                          ${ms(limits.idleInTransactionMs)}, true)`,
  );
}

let defaultWithFirm: WithFirm | undefined;
const defaultWaits: ConnectionWaits = { slow: 0, timedOut: 0 };

export function withFirm<T>(firmId: string, fn: (tx: FirmTx) => Promise<T>): Promise<T> {
  defaultWithFirm ??= createWithFirm(appPool(), {
    limits: dbProfile().limits,
    waits: defaultWaits,
  });
  return defaultWithFirm(firmId, fn);
}

// The default withFirm's waits since the last call, then counting from zero (P4.8's tick).
export function takeConnectionWaits(): ConnectionWaits {
  const taken = { ...defaultWaits };
  defaultWaits.slow = 0;
  defaultWaits.timedOut = 0;
  return taken;
}
