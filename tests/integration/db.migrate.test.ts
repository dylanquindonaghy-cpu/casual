import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createPool, type Db } from "@/lib/db/client";
import { testDatabaseUrl } from "../setup/test-db";

describe("database and migrations (real Postgres)", () => {
  let pool: Pool;
  let db: Db;

  beforeAll(() => {
    pool = createPool(testDatabaseUrl());
    db = createDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("connects to the test database", async () => {
    const result = await db.execute<{ db: string }>(sql`select current_database() as db`);
    expect(result.rows[0]?.db).toMatch(/_test$/);
  });

  it("has applied the init migration", async () => {
    const result = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});
