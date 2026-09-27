import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TABLE_ACCESS } from "@/lib/db/admin/access";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { EXPECTED_TABLES } from "../helpers/tenant-rows";

// The database catalogue, checked table by table: RLS is on and forced, the policy is exactly
// the tenant policy, the app role has exactly the grants in TABLE_ACCESS, and the role itself
// can't bypass any of it.

let su: Pool;
let app: Pool;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(1);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const tenantQual = (column: string) =>
  `(${column} = ( SELECT app_current_firm_id() AS app_current_firm_id))`;

describe("the app's database role", () => {
  it("tests connect as shiftdesk_app: no superuser, no BYPASSRLS, no role memberships", async () => {
    const { rows } = await app.query(
      `select current_user as user, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
         from pg_roles r where r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({
      user: "shiftdesk_app",
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      memberships: 0,
    });
  });

  it("owns no tables, and can't create tables, schemas or temp tables", async () => {
    const { rows } = await su.query(
      `select
         (select count(*)::int from pg_class where relowner = 'shiftdesk_app'::regrole
            and relnamespace = 'public'::regnamespace) as owned,
         has_database_privilege('shiftdesk_app', current_database(), 'CREATE') as db_create,
         has_database_privilege('shiftdesk_app', current_database(), 'TEMP') as db_temp,
         has_schema_privilege('shiftdesk_app', 'public', 'CREATE') as public_create,
         has_schema_privilege('shiftdesk_app', 'drizzle', 'USAGE') as drizzle_usage`,
    );
    expect(rows[0]).toEqual({
      owned: 0,
      db_create: false,
      db_temp: false,
      public_create: false,
      drizzle_usage: false,
    });
  });
});

describe.each(EXPECTED_TABLES)("table %s", (table) => {
  it("has row level security enabled and forced (binds the owner too)", async () => {
    const { rows } = await su.query(
      `select relrowsecurity as enabled, relforcerowsecurity as forced,
              pg_get_userbyid(relowner) as owner
         from pg_class where oid = $1::regclass`,
      [`public.${table}`],
    );
    expect(rows[0]).toEqual({ enabled: true, forced: true, owner: urls.owner });
  });

  it("has a NOT NULL uuid firm_id (firms: its uuid id)", async () => {
    const column = table === "firms" ? "id" : "firm_id";
    const { rows } = await su.query(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    expect(rows[0]).toEqual({ data_type: "uuid", is_nullable: "NO" });
  });

  it("has exactly the tenant policy, nothing looser", async () => {
    const { rows } = await su.query(
      `select policyname, permissive, roles::text as roles, cmd, qual, with_check
         from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`,
      [table],
    );
    const tenant = (name: string, cmd: string, column = "firm_id") => ({
      policyname: name,
      permissive: "PERMISSIVE",
      roles: "{public}",
      cmd,
      qual: cmd === "INSERT" ? null : tenantQual(column),
      with_check: cmd === "SELECT" ? null : tenantQual(column),
    });
    const expected =
      table === "events"
        ? [tenant("firm_isolation_insert", "INSERT"), tenant("firm_isolation_select", "SELECT")]
        : table === "firms"
          ? [
              // Only the owner (for app_resolve_firm) may read the whole directory.
              {
                policyname: "directory_read",
                permissive: "PERMISSIVE",
                roles: `{${urls.owner}}`,
                cmd: "SELECT",
                qual: "true",
                with_check: null,
              },
              tenant("firm_isolation", "ALL", "id"),
            ]
          : [tenant("firm_isolation", "ALL")];
    expect(rows).toEqual(expected);
  });

  it("grants the app role exactly what TABLE_ACCESS lists (never TRUNCATE)", async () => {
    const { rows } = await su.query<{ privilege: string }>(
      `select privilege_type as privilege from information_schema.role_table_grants
        where grantee = 'shiftdesk_app' and table_schema = 'public' and table_name = $1
        order by 1`,
      [table],
    );
    expect(rows.map((r) => r.privilege)).toEqual([...(TABLE_ACCESS[table] ?? [])].sort());
    expect(rows.map((r) => r.privilege)).not.toContain("TRUNCATE");
  });

  // What each role can actually do, however it got the right (a direct grant, PUBLIC, or a
  // column-level grant), not just what information_schema lists as granted to it by name.
  it("effective rights: the app role exactly TABLE_ACCESS, the jobs role nothing", async () => {
    const privileges = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ];
    const columnPrivileges = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
    const effective = async (role: string) => {
      const { rows } = await su.query<{
        privilege: string;
        table_level: boolean;
        any_column: boolean | null;
      }>(
        `select p as privilege,
                has_table_privilege($1, $2::regclass, p) as table_level,
                case when p = any($4::text[]) then has_any_column_privilege($1, $2::regclass, p) end as any_column
           from unnest($3::text[]) p`,
        [role, `public.${table}`, privileges, columnPrivileges],
      );
      return {
        table: rows
          .filter((r) => r.table_level)
          .map((r) => r.privilege)
          .sort(),
        anyColumn: rows
          .filter((r) => r.any_column)
          .map((r) => r.privilege)
          .sort(),
      };
    };
    const allowed = [...(TABLE_ACCESS[table] ?? [])].sort();
    expect(await effective("shiftdesk_app")).toEqual({
      table: allowed,
      anyColumn: allowed.filter((p) => columnPrivileges.includes(p)),
    });
    expect(await effective("shiftdesk_jobs")).toEqual({ table: [], anyColumn: [] });
  });

  it("grants nothing to PUBLIC, on the table or any of its columns", async () => {
    const { rows } = await su.query(
      `select (select count(*)::int from pg_class c, aclexplode(c.relacl) a
                where c.oid = $1::regclass and a.grantee = 0) as table_grants,
              (select count(*)::int from pg_attribute att, aclexplode(att.attacl) a
                where att.attrelid = $1::regclass and a.grantee = 0) as column_grants`,
      [`public.${table}`],
    );
    expect(rows[0]).toEqual({ table_grants: 0, column_grants: 0 });
  });
});

it("events is append-only for the app: no UPDATE or DELETE grant or policy", async () => {
  const { rows } = await su.query(
    `select has_table_privilege('shiftdesk_app', 'public.events', 'UPDATE') as upd,
            has_table_privilege('shiftdesk_app', 'public.events', 'DELETE') as del,
            (select count(*)::int from pg_policies where tablename = 'events'
               and cmd in ('UPDATE', 'DELETE', 'ALL')) as write_policies`,
  );
  expect(rows[0]).toEqual({ upd: false, del: false, write_policies: 0 });
});

it("every foreign key between firm tables includes firm_id on both sides", async () => {
  const { rows } = await su.query<{ name: string; local: string[]; remote: string[] }>(
    `select c.conname as name,
            array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, n)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                   order by k.n) as local,
            array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum, n)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
                   order by k.n) as remote
       from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.confrelid <> 'public.firms'::regclass`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const fk of rows) {
    expect(fk.local[0], fk.name).toBe("firm_id");
    expect(fk.remote[0], fk.name).toBe("firm_id");
  }
});

describe("the job queue (pgboss schema)", () => {
  it("the app role may only enqueue: SELECT on queue, INSERT and SELECT(id) on job_common", async () => {
    const { rows } = await su.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'shiftdesk_app' and table_schema = 'pgboss' order by 1, 2`,
    );
    expect(rows).toEqual([
      { table_name: "job_common", privilege_type: "INSERT" },
      { table_name: "queue", privilege_type: "SELECT" },
    ]);
    const cols = await su.query(
      `select column_name, privilege_type from information_schema.column_privileges
        where grantee = 'shiftdesk_app' and table_schema = 'pgboss' and table_name = 'job_common'
          and privilege_type = 'SELECT'`,
    );
    expect(cols.rows).toEqual([{ column_name: "id", privilege_type: "SELECT" }]);
  });

  it("PUBLIC can execute no pg-boss function; the app role only job_now()", async () => {
    const { rows } = await su.query<{ fn: string; pub: boolean; app: boolean }>(
      `select p.proname as fn,
              coalesce(p.proacl::text like '%,=X/%' or p.proacl::text like '{=X/%', true) as pub,
              has_function_privilege('shiftdesk_app', p.oid, 'EXECUTE') as app
         from pg_proc p where p.pronamespace = 'pgboss'::regnamespace order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.pub).map((r) => r.fn)).toEqual([]);
    expect(rows.filter((r) => r.app).map((r) => r.fn)).toEqual(["job_now"]);
  });

  it("job_common has RLS and the two policies tying a job's firmId to the current firm", async () => {
    const { rows } = await su.query(
      `select policyname, roles::text as roles, cmd from pg_policies
        where schemaname = 'pgboss' and tablename = 'job_common' order by 1`,
    );
    expect(rows).toEqual([
      { policyname: "app_enqueue", roles: "{shiftdesk_app}", cmd: "INSERT" },
      { policyname: "app_returning", roles: "{shiftdesk_app}", cmd: "SELECT" },
    ]);
    const rls = await su.query(
      "select relrowsecurity as on from pg_class where oid = 'pgboss.job_common'::regclass",
    );
    expect(rls.rows[0]).toEqual({ on: true });
  });
});

describe("the rest of the public schema", () => {
  it("holds tables only: no views, materialized views or foreign tables (they would skip RLS)", async () => {
    const { rows } = await su.query(
      `select relname, relkind::text from pg_class
        where relnamespace = 'public'::regnamespace and relkind in ('v', 'm', 'f') order by 1`,
    );
    expect(rows).toEqual([]);
  });

  it("the app role can execute exactly two functions: app_current_firm_id and app_resolve_firm", async () => {
    const { rows } = await su.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and has_function_privilege('shiftdesk_app', p.oid, 'EXECUTE')
        order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual(["app_current_firm_id", "app_resolve_firm"]);
  });

  it("the app and jobs roles have no rights on any sequence (identity columns don't need them)", async () => {
    const { rows } = await su.query(
      `select c.relname, r.role, p.privilege from pg_class c
         cross join unnest(array['shiftdesk_app', 'shiftdesk_jobs']) r(role)
         cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and has_sequence_privilege(r.role, c.oid, p.privilege)`,
    );
    expect(rows).toEqual([]);
    const { rows: seqs } = await su.query(
      "select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S'",
    );
    expect(seqs[0]?.n).toBeGreaterThan(0); // events.id's identity sequence: the check above ran on something
  });
});
