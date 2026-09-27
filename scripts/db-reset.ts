import { APP_DB_ROLE, JOBS_DB_ROLE, adminEnv } from "../src/lib/env";
import { ensureOwnerRole, recreateDatabase, syncRolePassword } from "../src/lib/db/admin/bootstrap";
import { runMigrations } from "../src/lib/db/admin/migrate";
import { seed } from "../src/lib/db/admin/seed";
import {
  bootstrapUrl,
  credentials,
  databaseName,
  isLocalHost,
  ownerRoleFromAdminUrl,
} from "../src/lib/db/admin/urls";

// Local development only: drops the dev database, recreates it owned by the non-superuser owner
// role, runs every migration and loads the demo seed. Everything in the local dev database is lost.
const env = adminEnv();
if (env.NODE_ENV === "production")
  throw new Error("db:reset refuses to run with NODE_ENV=production");
for (const url of [env.DATABASE_ADMIN_URL, env.DATABASE_URL, env.DATABASE_JOBS_URL]) {
  if (!isLocalHost(url)) throw new Error("db:reset only runs against a database on this machine");
}
const owner = ownerRoleFromAdminUrl(env.DATABASE_ADMIN_URL);
if (!owner) {
  throw new Error("DATABASE_ADMIN_URL needs ?options=-c role=<owner> locally (see .env.example)");
}
const superuser = bootstrapUrl(env.DATABASE_ADMIN_URL);
const dbName = databaseName(env.DATABASE_ADMIN_URL);

await ensureOwnerRole(superuser, owner);
// Roles are shared by every local database. Keep their passwords in step with .env.
await syncRolePassword(superuser, APP_DB_ROLE, credentials(env.DATABASE_URL).password);
await syncRolePassword(superuser, JOBS_DB_ROLE, credentials(env.DATABASE_JOBS_URL).password);

await recreateDatabase(superuser, dbName, owner);
await runMigrations({
  adminUrl: env.DATABASE_ADMIN_URL,
  appUrl: env.DATABASE_URL,
  jobsUrl: env.DATABASE_JOBS_URL,
});
await seed({ adminUrl: env.DATABASE_ADMIN_URL, appUrl: env.DATABASE_URL, nodeEnv: env.NODE_ENV });
console.log(`Recreated ${dbName}, applied migrations and loaded the demo firms.`);
