import { Client } from "pg";
import { runMigrations } from "../../src/lib/db/migrate";
import { testDatabaseUrl } from "./test-db";

// Runs once before the suite: make sure the test database exists, then apply migrations.
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.replace(/^\//, "");

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach Postgres at ${url.host}. Start it with: npm run db:up\n${String(err)}`,
    );
  }
  try {
    const found = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (found.rowCount === 0) await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runMigrations(url.toString());
}
