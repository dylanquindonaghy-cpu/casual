import type { ClientBase } from "pg";

// Login roles for the app and the worker's job queue. Runs as the owner before migrations.
// Roles are created only when missing. An existing role is never altered here: a non-superuser
// owner (Lightsail's master user) can't change SUPERUSER/BYPASSRLS anyway, and re-setting the
// password on every deploy could silently lock out running processes. We check it instead.

export async function ensureLoginRole(
  client: ClientBase,
  role: { name: string; password: string },
): Promise<"created" | "exists"> {
  const found = await client.query("select 1 from pg_roles where rolname = $1", [role.name]);
  if (found.rowCount === 0) {
    if (!role.password) throw new Error(`No password for role ${role.name} in its connection URL`);
    // CREATE ROLE can't take bind parameters, so quote both values.
    await client.query(
      `create role ${client.escapeIdentifier(role.name)} login password ${client.escapeLiteral(role.password)}
         nosuperuser nobypassrls nocreatedb nocreaterole inherit`,
    );
    await assertRestrictedRole(client, role.name);
    return "created";
  }
  await assertRestrictedRole(client, role.name);
  return "exists";
}

export async function assertRestrictedRole(client: ClientBase, name: string): Promise<void> {
  const { rows } = await client.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    memberships: number;
  }>(
    `select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
       from pg_roles r where r.rolname = $1`,
    [name],
  );
  const r = rows[0];
  if (!r) throw new Error(`Role ${name} does not exist`);
  const problems = [
    r.rolsuper && "SUPERUSER",
    r.rolbypassrls && "BYPASSRLS",
    r.rolcreaterole && "CREATEROLE",
    r.rolcreatedb && "CREATEDB",
    // A membership could make a policy written TO another role apply to this one.
    r.memberships > 0 && "member of another role",
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Role ${name} must be restricted but has: ${problems.join(", ")}`);
  }
}
