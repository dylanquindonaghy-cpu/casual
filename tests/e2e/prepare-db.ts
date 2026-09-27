import { ensureOwnerRole, recreateDatabase } from "../../src/lib/db/admin/bootstrap";
import { runMigrations } from "../../src/lib/db/admin/migrate";
import { seed } from "../../src/lib/db/admin/seed";
import {
  bootstrapUrl,
  databaseName,
  isLocalHost,
  ownerRoleFromAdminUrl,
} from "../../src/lib/db/admin/urls";

// A fresh *_e2e database (migrated, seeded), so end-to-end tests never depend on, or change,
// the dev database. Called by tests/e2e/worker.ts once it holds the e2e lock.
export async function prepareE2eDatabase(): Promise<void> {
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const adminUrl = need("DATABASE_ADMIN_URL");
  const appUrl = need("DATABASE_URL");
  const jobsUrl = need("DATABASE_JOBS_URL");
  const name = databaseName(adminUrl);
  const owner = ownerRoleFromAdminUrl(adminUrl);
  if (!name.endsWith("_e2e")) throw new Error(`Refusing e2e database "${name}"`);
  if (![adminUrl, appUrl, jobsUrl].every(isLocalHost)) {
    throw new Error("e2e runs on a local database only");
  }
  if (!owner) throw new Error("DATABASE_ADMIN_URL needs ?options=-c role=<owner>");

  await ensureOwnerRole(bootstrapUrl(adminUrl), owner);
  await recreateDatabase(bootstrapUrl(adminUrl), name, owner);
  await runMigrations({ adminUrl, appUrl, jobsUrl });
  await seed({ adminUrl, appUrl, nodeEnv: "test" });
  console.log(`[e2e] ${name} ready`);
}
