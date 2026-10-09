import { adminEnv } from "../src/lib/env";
import { runMigrations } from "../src/lib/db/admin/migrate";

// Runs as a one-off step with the owner's credentials (docs/runbooks.md, Deploy). The web and
// worker never hold DATABASE_ADMIN_URL.
const env = adminEnv();
await runMigrations({
  adminUrl: env.DATABASE_ADMIN_URL,
  appUrl: env.DATABASE_URL,
  jobsUrl: env.DATABASE_JOBS_URL,
});
console.log("Migrations applied.");
