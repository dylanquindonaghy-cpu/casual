import { rm } from "node:fs/promises";
import { Client } from "pg";
import { bootstrapUrl, withDatabase } from "../../src/lib/db/admin/urls";
import { prepareE2eDatabase } from "./prepare-db";

// The e2e worker process (started by playwright.config.ts). Before it touches anything it takes
// an advisory lock held for its whole life: if another e2e run holds it, this run stops here,
// without dropping that run's database or deleting its outbox.
const outbox = process.env.CONSOLE_OUTBOX_FILE;
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl || !outbox) throw new Error("DATABASE_ADMIN_URL and CONSOLE_OUTBOX_FILE must be set");

const lock = new Client({ connectionString: withDatabase(bootstrapUrl(adminUrl), "postgres") });
await lock.connect();
const got = await lock.query<{ ok: boolean }>(
  "select pg_try_advisory_lock(hashtext('shiftdesk-e2e-run')) as ok",
);
if (!got.rows[0]?.ok) {
  console.error("[e2e] another e2e run is in progress; wait for it to finish, then run again");
  process.exit(1);
}

await rm(outbox, { force: true });
await prepareE2eDatabase();
await import("../../src/worker/index");
