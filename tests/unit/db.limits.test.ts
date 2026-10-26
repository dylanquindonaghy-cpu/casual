import { afterEach, describe, expect, it } from "vitest";
import { appPool, DB_PROFILES, dbProfile, chooseDbProfile } from "@/lib/db/pool";
import { LONG_TRANSACTIONS } from "@/lib/db/scoped";

// Each process's share of the database and its time limits (PLAN.md P4.2; ADR-027).

describe("the database profiles", () => {
  it("the web app waits briefly and its work is short; the worker's may take longer", () => {
    expect(DB_PROFILES.web).toEqual({
      poolMax: 10,
      connectWaitMs: 5_000,
      limits: { statementMs: 15_000, idleInTransactionMs: 30_000 },
    });
    expect(DB_PROFILES.worker).toEqual({
      poolMax: 15,
      connectWaitMs: 30_000,
      limits: { statementMs: 60_000, idleInTransactionMs: 60_000 },
    });
  });

  it("about 30 connections in all with pg-boss's 5 (the budget in docs/runbooks.md)", () => {
    expect(DB_PROFILES.web.poolMax + DB_PROFILES.worker.poolMax + 5).toBe(30);
  });

  it("the few long transactions get more time; the scan's lock holder may sit idle", () => {
    // Above the scan's own 5-minute lock_timeout, so that ends a stuck wait first (scan.ts).
    expect(LONG_TRANSACTIONS.scanLockHolder).toEqual({
      statementMs: 6 * 60_000,
      idleInTransactionMs: 0,
    });
    for (const limits of Object.values(LONG_TRANSACTIONS)) {
      expect(limits.statementMs).toBeGreaterThan(DB_PROFILES.worker.limits.statementMs);
    }
  });
});

describe("choosing the profile", () => {
  let made: ReturnType<typeof appPool> | undefined;
  afterEach(async () => {
    await made?.end();
  });

  it("is web unless the process picks the worker's before its first query", () => {
    expect(dbProfile()).toBe(DB_PROFILES.web);
    chooseDbProfile("worker");
    expect(dbProfile()).toBe(DB_PROFILES.worker);
    made = appPool();
    expect(made.options.max).toBe(15);
    expect(made.options.connectionTimeoutMillis).toBe(30_000);
    // Too late now: the pool was made with the worker's sizes.
    expect(() => chooseDbProfile("web")).toThrow(/already runs with the worker profile/);
    expect(() => chooseDbProfile("worker")).not.toThrow();
  });
});
