import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTableSecurity } from "@/lib/db/admin/access";
import { runMigrations } from "@/lib/db/admin/migrate";
import { ownerPool, urls } from "../helpers/db";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string }[];
};

async function appliedCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );
  return result.rows[0]?.count ?? -1;
}

describe("database and migrations (real Postgres)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = ownerPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("connects to the test database as the non-superuser owner", async () => {
    const result = await pool.query<{ db: string; user: string; rolsuper: boolean }>(
      `select current_database() as db, current_user as user, r.rolsuper
         from pg_roles r where r.rolname = current_user`,
    );
    expect(result.rows[0]?.db).toMatch(/_test$/);
    expect(result.rows[0]?.user).toBe(urls.owner);
    expect(result.rows[0]?.rolsuper).toBe(false);
  });

  it("has applied every migration in the journal", async () => {
    expect(journal.entries.length).toBeGreaterThanOrEqual(4);
    expect(await appliedCount(pool)).toBe(journal.entries.length);
  });

  it("running the migrations again is a no-op", async () => {
    const before = await appliedCount(pool);
    await runMigrations({ adminUrl: urls.admin, appUrl: urls.app, jobsUrl: urls.jobs });
    expect(await appliedCount(pool)).toBe(before);
  });

  it.each([
    [
      "a table with no TABLE_ACCESS entry",
      "create table public.stray (id int)",
      /No entry for: \[stray\]/,
    ],
    [
      "a table with no RLS policy",
      "drop policy firm_isolation on public.sites",
      /no RLS policy: sites/,
    ],
  ])("the grants step refuses %s", async (_label, change, message) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(change);
      await expect(applyTableSecurity(client)).rejects.toThrow(message);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("every pg-boss table belongs to the jobs role, not the app or the owner", async () => {
    const result = await pool.query<{ relname: string; owner: string }>(
      `select c.relname, pg_get_userbyid(c.relowner) as owner from pg_class c
        where c.relnamespace = 'pgboss'::regnamespace and c.relkind in ('r', 'p')`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.filter((r) => r.owner !== "shiftdesk_jobs")).toEqual([]);
  });
});
