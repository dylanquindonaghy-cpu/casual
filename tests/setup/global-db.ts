import { Client } from "pg";
import { ensureOwnerRole, recreateDatabase } from "../../src/lib/db/admin/bootstrap";
import { runMigrations } from "../../src/lib/db/admin/migrate";
import { withDatabase } from "../../src/lib/db/admin/urls";
import { testUrls } from "./test-db";

// Runs once before the suite: a fresh test database every run, built the same way as prod
// (owner role, then migrations, grants, pg-boss). runMigrations ends by checking that the app
// role really is restricted, so the suite aborts if tests would run with RLS bypassed.
//
// Only one test run at a time on this machine: a second run would drop the database under the
// first. The run holds a Postgres advisory lock until it ends; another run waits for it.
export default async function setup(): Promise<() => Promise<void>> {
  const urls = testUrls();
  const lock = new Client({ connectionString: withDatabase(urls.superuser, "postgres") });
  try {
    await lock.connect();
  } catch (err) {
    throw new Error(`Cannot reach Postgres. Start it with: npm run db:up\n${String(err)}`);
  }
  const key = `shiftdesk-test-run:${urls.name}`;
  const free = await lock.query<{ ok: boolean }>(
    "select pg_try_advisory_lock(hashtext($1)) as ok",
    [key],
  );
  if (!free.rows[0]?.ok) {
    console.log("[tests] another test run is using the test database; waiting for it to finish");
    await lock.query("select pg_advisory_lock(hashtext($1))", [key]);
  }
  await ensureOwnerRole(urls.superuser, urls.owner);
  await recreateDatabase(urls.superuser, urls.name, urls.owner);
  await runMigrations({ adminUrl: urls.admin, appUrl: urls.app, jobsUrl: urls.jobs });
  return async () => {
    await lock.end(); // releases the lock
  };
}
