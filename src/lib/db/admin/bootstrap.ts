import { Client } from "pg";

// Local-only bootstrap, run as the Docker superuser: create the non-superuser owner role and
// (re)create a local database owned by it. Production never runs this: on Lightsail the master
// user already exists and owns the database.

// Both helpers connect to the "postgres" maintenance database: the target database may not
// exist yet (a fresh CI runner, a new e2e database).
function maintenanceUrl(superuserUrl: string): string {
  const u = new URL(superuserUrl);
  u.pathname = "/postgres";
  return u.toString();
}

export async function ensureOwnerRole(superuserUrl: string, owner: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(superuserUrl) });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_roles where rolname = $1", [owner]);
    if (found.rowCount === 0) {
      // Like a managed-Postgres master user: can create roles and databases, but no superuser
      // and no BYPASSRLS, so FORCE ROW LEVEL SECURITY applies to it.
      await client.query(
        `create role ${client.escapeIdentifier(owner)} nologin nosuperuser nobypassrls createrole createdb`,
      );
    }
  } finally {
    await client.end();
  }
}

// Drops and recreates a database, forcibly disconnecting any sessions on it.
export async function recreateDatabase(
  superuserUrl: string,
  name: string,
  owner: string,
): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(superuserUrl) });
  await client.connect();
  try {
    const db = client.escapeIdentifier(name);
    await client.query(`drop database if exists ${db} with (force)`);
    await client.query(`create database ${db} owner ${client.escapeIdentifier(owner)}`);
  } finally {
    await client.end();
  }
}

// Dev only: make an existing login role's password match .env again (roles are shared by every
// database in the local cluster). A role that doesn't exist yet is left for runMigrations to
// create. Never used against a non-local server.
export async function syncRolePassword(
  superuserUrl: string,
  role: string,
  password: string,
): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(superuserUrl) });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    if (found.rowCount === 0) return;
    await client.query(
      `alter role ${client.escapeIdentifier(role)} password ${client.escapeLiteral(password)}`,
    );
  } finally {
    await client.end();
  }
}
