import { sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { applyCredentialPack } from "../../credentials/apply-pack";
import { createWithFirm, type FirmTx } from "../scoped";
import { credentials, officeUsers, sites, workers } from "../schema";
import { seedFirms, type SeedFirm } from "./seed-data";
import { isLocalHost } from "./urls";

// Loads the demo firms (docs/testing.md). Firms are created through the owner connection (the
// app role can't create firms); everything else goes through withFirm as the app role, like the
// app itself. Rows are upserted by fixed ids, so running it again changes nothing, and it puts
// seeded rows back as seeded (status included). Rows added during a demo stay: only
// `npm run db:reset` returns the database to exactly the demo state.

export interface SeedSummary {
  firms: {
    slug: string;
    sites: number;
    officeUsers: number;
    workers: number;
    credentials: number;
  }[];
}

export async function seed(opts: {
  adminUrl: string;
  appUrl: string;
  nodeEnv: string;
  today?: Date;
}): Promise<SeedSummary> {
  // Checked before any connection is made (golden rule 7: fake data, never near real data).
  if (opts.nodeEnv === "production")
    throw new Error("The seed never runs with NODE_ENV=production");
  if (!isLocalHost(opts.adminUrl) || !isLocalHost(opts.appUrl)) {
    throw new Error("The seed only runs against a database on this machine");
  }

  const firms = seedFirms(opts.today);
  const owner = new Client({ connectionString: opts.adminUrl });
  const appPool = new Pool({ connectionString: opts.appUrl, max: 2 });
  const withFirm = createWithFirm(appPool);
  await owner.connect();
  try {
    const summary: SeedSummary = { firms: [] };
    for (const firm of firms) {
      await provisionFirm(owner, firm);
      await withFirm(firm.id, (tx) => loadFirm(tx, firm));
      summary.firms.push({
        slug: firm.slug,
        sites: firm.sites.length,
        officeUsers: firm.officeUsers.length,
        workers: firm.workers.length,
        credentials: firm.credentials.length,
      });
    }
    return summary;
  } finally {
    await owner.end();
    await appPool.end();
  }
}

// RLS is forced for the owner too, so it sets the firm it is creating, exactly like withFirm.
async function provisionFirm(owner: Client, firm: SeedFirm): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.current_firm_id', $1, true)", [firm.id]);
    await owner.query(
      `insert into firms (id, name, slug, sector, settings) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, slug = excluded.slug,
         sector = excluded.sector, settings = excluded.settings`,
      [firm.id, firm.name, firm.slug, firm.sector, JSON.stringify(firm.settings)],
    );
    await owner.query("commit");
  } catch (err) {
    await owner.query("rollback");
    throw err;
  }
}

async function loadFirm(tx: FirmTx, firm: SeedFirm): Promise<void> {
  const firmId = firm.id;
  // The sector's credential types and default role rules first; existing ones stay as they are.
  await applyCredentialPack(tx, firm.sector, { type: "system" });
  await tx
    .insert(sites)
    .values(firm.sites.map((s) => ({ ...s, firmId })))
    .onConflictDoUpdate({
      target: sites.id,
      set: { name: sql`excluded.name`, town: sql`excluded.town`, postcode: sql`excluded.postcode` },
    });
  await tx
    .insert(officeUsers)
    .values(firm.officeUsers.map((u) => ({ ...u, firmId })))
    .onConflictDoUpdate({
      target: officeUsers.id,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        status: sql`'active'`,
      },
    });
  await tx
    .insert(workers)
    .values(firm.workers.map((w) => ({ ...w, firmId })))
    .onConflictDoUpdate({
      target: workers.id,
      set: {
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        mobileE164: sql`excluded.mobile_e164`,
        email: sql`excluded.email`,
        roles: sql`excluded.roles`,
        status: sql`'active'`,
      },
    });
  await tx
    .insert(credentials)
    .values(firm.credentials.map((c) => ({ ...c, firmId })))
    .onConflictDoUpdate({
      target: credentials.id,
      set: {
        type: sql`excluded.type`,
        number: sql`excluded.number`,
        expiresOn: sql`excluded.expires_on`,
        status: sql`excluded.status`,
        verifiedAt: sql`null`,
        verifiedBy: sql`null`,
      },
    });
}
