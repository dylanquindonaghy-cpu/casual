import { Client } from "pg";
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
  await markToursSeen(bootstrapUrl(adminUrl));
  console.log(`[e2e] ${name} ready`);
}

// (As the superuser: row security is forced on the owner too.)
// The first-login tours (Phase 33.1) open by themselves for anyone who hasn't seen theirs, over the
// page a spec is about to use. The seed leaves everyone's unseen (as the demo wants), so here every
// seeded office user and casual has seen theirs; a spec's own office users too (tests/e2e/db.ts
// addOfficeUser). The tour's own spec (tests/e2e/office.tour.spec.ts) adds a person who hasn't.
async function markToursSeen(superuserUrl: string): Promise<void> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query("update office_users set tour_seen_at = now() where tour_seen_at is null");
    await client.query("update workers set tour_seen_at = now() where tour_seen_at is null");
  } finally {
    await client.end();
  }
}
