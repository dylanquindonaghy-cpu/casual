import { existsSync } from "node:fs";
import {
  bootstrapUrl,
  databaseName,
  isLocalHost,
  ownerRoleFromAdminUrl,
  withDatabase,
} from "../../src/lib/db/admin/urls";

if (existsSync(".env")) process.loadEnvFile(".env");

export interface TestUrls {
  name: string; // the test database, always *_test
  app: string; // shiftdesk_app
  jobs: string; // shiftdesk_jobs
  admin: string; // the owner (non-superuser)
  superuser: string; // local bootstrap only: creates the owner role and the test database
  owner: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  return value;
}

// Tests use the same three URLs as the app with "_test" added to the database name, so the
// passwords always match (roles are shared by every database in the cluster). Anything that
// isn't clearly a local *_test database is refused, so tests can never touch dev or prod data.
export function testUrls(): TestUrls {
  const app = required("DATABASE_URL");
  const jobs = required("DATABASE_JOBS_URL");
  const admin = required("DATABASE_ADMIN_URL");
  const base = databaseName(admin);
  if (databaseName(app) !== base || databaseName(jobs) !== base) {
    throw new Error(
      "DATABASE_URL, DATABASE_JOBS_URL and DATABASE_ADMIN_URL must name the same database",
    );
  }
  for (const url of [app, jobs, admin]) {
    if (!isLocalHost(url))
      throw new Error("Tests only run against a local Postgres (npm run db:up)");
  }
  const owner = ownerRoleFromAdminUrl(admin);
  if (!owner) {
    throw new Error(
      "DATABASE_ADMIN_URL needs ?options=-c role=<owner> for tests (see .env.example)",
    );
  }
  const name = base.endsWith("_test") ? base : `${base}_test`;
  if (!name.endsWith("_test")) throw new Error(`Refusing test database "${name}"`);
  return {
    name,
    app: withDatabase(app, name),
    jobs: withDatabase(jobs, name),
    admin: withDatabase(admin, name),
    superuser: bootstrapUrl(withDatabase(admin, name)),
    owner,
  };
}
