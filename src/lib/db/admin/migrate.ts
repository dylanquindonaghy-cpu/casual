import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { APP_DB_ROLE, JOBS_DB_ROLE } from "../../env";
import { applyTableSecurity } from "./access";
import { installJobs } from "./jobs";
import { assertRestrictedRole, ensureLoginRole } from "./roles";
import { credentials, databaseName } from "./urls";

export const MIGRATIONS_FOLDER = "./drizzle";

export interface MigrateUrls {
  adminUrl: string; // the owner: runs migrations, owns the tables
  appUrl: string; // shiftdesk_app
  jobsUrl: string; // shiftdesk_jobs
}

// The one migration path, used by `npm run db:migrate`, `npm run db:reset` and the test setup.
// Order matters: roles -> migrations -> FORCE RLS + grants -> pg-boss -> check the app role.
export async function runMigrations(urls: MigrateUrls): Promise<void> {
  const db = databaseName(urls.adminUrl);
  if (databaseName(urls.appUrl) !== db || databaseName(urls.jobsUrl) !== db) {
    throw new Error(
      "DATABASE_URL, DATABASE_JOBS_URL and DATABASE_ADMIN_URL must name the same database",
    );
  }

  const pool = new Pool({ connectionString: urls.adminUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await preflight(client);
      await ensureLoginRole(client, {
        name: APP_DB_ROLE,
        password: credentials(urls.appUrl).password,
      });
      await ensureLoginRole(client, {
        name: JOBS_DB_ROLE,
        password: credentials(urls.jobsUrl).password,
      });
    } finally {
      client.release();
    }

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    const client2 = await pool.connect();
    try {
      await client2.query("begin");
      await applyTableSecurity(client2);
      await client2.query("commit");
    } catch (err) {
      await client2.query("rollback");
      throw err;
    } finally {
      client2.release();
    }
  } finally {
    await pool.end();
  }

  await installJobs(urls.jobsUrl);
  await checkAppConnection(urls.appUrl);
}

// Phase 0 databases were created by the superuser, so their drizzle/pgboss schemas belong to it.
// The non-superuser owner can't take them over; say what to do instead of failing obscurely.
async function preflight(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ nspname: string; owner: string; me: string }>(
    `select n.nspname, pg_get_userbyid(n.nspowner) as owner, current_user as me
       from pg_namespace n where n.nspname in ('drizzle', 'pgboss')`,
  );
  const foreign = rows.filter((r) => r.owner !== r.me);
  if (foreign.length > 0) {
    const list = foreign.map((r) => `${r.nspname} (owned by ${r.owner})`).join(", ");
    throw new Error(
      `This database was set up before Phase 1 (${list}). ` +
        "Locally, run `npm run db:reset` once. It recreates the dev database with the new roles.",
    );
  }
}

// Connects as the app role and proves it is the restricted role we expect.
async function checkAppConnection(appUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: appUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ user: string }>("select current_user as user");
      if (rows[0]?.user !== APP_DB_ROLE) {
        throw new Error(`DATABASE_URL connects as ${rows[0]?.user}, expected ${APP_DB_ROLE}`);
      }
      await assertRestrictedRole(client, APP_DB_ROLE);
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "28P01") {
      throw new Error(
        `The ${APP_DB_ROLE} password doesn't match DATABASE_URL. Locally: npm run db:reset.`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    await pool.end();
  }
}
