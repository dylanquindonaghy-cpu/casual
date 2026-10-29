import type { ClientBase, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLUMN_UPDATES, schemaTableNames, TABLE_ACCESS } from "@/lib/db/admin/access";
import { appRolePool, superuserPool } from "../helpers/db";
import {
  countAll,
  countById,
  deleteById,
  inFirm,
  pgError,
  run,
  touchById,
} from "../helpers/rls-probe";
import {
  createTenant,
  EXPECTED_TABLES,
  FK_CASES,
  INSERTS,
  type Tenant,
} from "../helpers/tenant-rows";

// Firm A's session can't read or write Firm B's rows, table by table (golden rule 2).
// Every negative check has a positive control: the same statement in Firm B's own context does
// work. Without it, "0 rows" could just mean a broken fixture. Runs as shiftdesk_app, the role
// the web and worker use (not a superuser, no BYPASSRLS, owns nothing).

let su: Pool;
let app: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool();
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const can = (table: string, privilege: "SELECT" | "INSERT" | "UPDATE" | "DELETE") =>
  (TABLE_ACCESS[table] ?? []).includes(privilege);

it("covers every table in the database, in the schema and in the fixtures", async () => {
  const { rows } = await su.query<{ name: string }>(
    `select relname as name from pg_class
      where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1`,
  );
  const expected = [...EXPECTED_TABLES];
  expect(rows.map((r) => r.name)).toEqual(expected);
  expect(schemaTableNames()).toEqual(expected);
  expect(Object.keys(INSERTS).sort()).toEqual(expected);
});

it("runs as the restricted app role", async () => {
  const { rows } = await app.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
    "select current_user as user, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
  );
  expect(rows[0]).toEqual({ user: "shiftdesk_app", rolsuper: false, rolbypassrls: false });
});

describe.each(EXPECTED_TABLES)("%s", (table) => {
  it("Firm A can't read Firm B's row (control: Firm B can)", async () => {
    const id = B.rows[table];
    const truth = await su.query(`select 1 from public.${table} where id = $1`, [id]);
    expect(truth.rowCount).toBe(1);
    if (!can(table, "SELECT")) {
      // firm_secrets (P5.1): the app role can't read the table at all, not even its own firm's.
      for (const firmId of [A.firmId, B.firmId]) {
        const read = await pgError(inFirm(app, firmId, (c) => countById(c, table, id)));
        expect(read).toMatchObject({ code: "42501" });
      }
      return;
    }
    expect(await inFirm(app, B.firmId, (c) => countById(c, table, id))).toBe(1);
    expect(await inFirm(app, A.firmId, (c) => countById(c, table, id))).toBe(0);
  });

  // Update and delete are checked separately: the rota's evidence tables (shifts, assignments,
  // requests, offers) grant UPDATE but not DELETE.
  it("Firm A can't update Firm B's row (control: Firm B can)", async () => {
    const id = B.rows[table];
    if (can(table, "UPDATE")) {
      // Control, rolled back: Firm B can change its own row.
      expect(await inFirm(app, B.firmId, (c) => touchById(c, table, id))).toBe(1);
      // A committed attempt from Firm A changes nothing, silently (RLS hides the row).
      expect(await inFirm(app, A.firmId, (c) => touchById(c, table, id), { commit: true })).toBe(0);
      const truth = await su.query(`select 1 from public.${table} where id = $1`, [id]);
      expect(truth.rowCount).toBe(1);
    } else {
      // firms, events and roster_sources: the app role can't update the row as a whole, in any
      // firm.
      for (const firmId of [A.firmId, B.firmId]) {
        const upd = await pgError(inFirm(app, firmId, (c) => touchById(c, table, id)));
        expect(upd).toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied/),
        });
      }
    }
    // A column the app may update (COLUMN_UPDATES): the same check on that column.
    const column = COLUMN_UPDATES[table]?.[0];
    if (column) {
      const touch = (c: ClientBase) =>
        c
          .query(
            `update public.${table} set ${c.escapeIdentifier(column)} = ${c.escapeIdentifier(column)} where id = $1`,
            [id],
          )
          .then((r) => r.rowCount ?? -1);
      expect(await inFirm(app, B.firmId, touch)).toBe(1);
      expect(await inFirm(app, A.firmId, touch, { commit: true })).toBe(0);
    }
  });

  it("Firm A can't delete Firm B's row (control: Firm B can)", async () => {
    const id = B.rows[table];
    if (can(table, "DELETE")) {
      // Control, rolled back: Firm B can delete its own row.
      expect(await inFirm(app, B.firmId, (c) => deleteById(c, table, id))).toBe(1);
      // A committed attempt from Firm A deletes nothing, silently (RLS hides the row).
      expect(await inFirm(app, A.firmId, (c) => deleteById(c, table, id), { commit: true })).toBe(
        0,
      );
      const truth = await su.query(`select 1 from public.${table} where id = $1`, [id]);
      expect(truth.rowCount).toBe(1);
    } else {
      // firms, events and the rota's evidence tables: the app role has no DELETE, in any firm.
      for (const firmId of [A.firmId, B.firmId]) {
        const del = await pgError(inFirm(app, firmId, (c) => deleteById(c, table, id)));
        expect(del).toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied/),
        });
      }
    }
  });

  it("Firm A can't move its own row to Firm B (control: an ordinary update works)", async () => {
    const id = A.rows[table];
    const column = table === "firms" ? "id" : "firm_id";
    const move = (c: ClientBase) =>
      c.query(`update public.${table} set ${column} = $1 where id = $2`, [B.firmId, id]);
    if (can(table, "UPDATE")) {
      expect(await inFirm(app, A.firmId, (c) => touchById(c, table, id))).toBe(1);
      const err = await pgError(inFirm(app, A.firmId, move));
      expect(err).toMatchObject({
        code: "42501",
        message: expect.stringMatching(/row-level security/),
      });
    } else {
      const err = await pgError(inFirm(app, A.firmId, move));
      expect(err).toMatchObject({
        code: "42501",
        message: expect.stringMatching(/permission denied/),
      });
    }
  });

  it("Firm A can't insert a row stamped with Firm B (control: Firm B can)", async () => {
    if (can(table, "INSERT")) {
      expect(await inFirm(app, B.firmId, (c) => run(c, INSERTS[table](B.firmId, B)))).toBe(1);
      const err = await pgError(inFirm(app, A.firmId, (c) => run(c, INSERTS[table](B.firmId, B))));
      expect(err).toMatchObject({
        code: "42501",
        message: expect.stringMatching(/row-level security/),
      });
    } else {
      // firms, roster_sources and name_map: created only by an owner script, never by the app.
      for (const firmId of [A.firmId, B.firmId]) {
        const err = await pgError(inFirm(app, firmId, (c) => run(c, INSERTS[table](firmId, B))));
        expect(err).toMatchObject({
          code: "42501",
          message: expect.stringMatching(/permission denied/),
        });
      }
    }
  });

  it("with no firm set, the app sees none of its rows", async () => {
    const truth = await su.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
    expect(truth.rows[0]?.n).toBeGreaterThan(0);
    if (!can(table, "SELECT")) {
      const read = await pgError(inFirm(app, null, (c) => countAll(c, table)));
      expect(read).toMatchObject({ code: "42501" });
      return;
    }
    expect(await inFirm(app, null, (c) => countAll(c, table))).toBe(0);
  });
});

it("covers every composite foreign key between firm tables", async () => {
  const { rows } = await su.query<{ name: string }>(
    `select conname as name from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
        and confrelid <> 'public.firms'::regclass order by 1`,
  );
  expect(rows.map((r) => r.name)).toEqual(Object.keys(FK_CASES).sort());
});

describe.each(Object.keys(FK_CASES))("foreign key %s", (fk) => {
  it("Firm A can't point a row at Firm B's parent row (control: Firm B can)", async () => {
    const build = FK_CASES[fk];
    if (!build) throw new Error(`no case for ${fk}`);
    expect(await inFirm(app, B.firmId, (c) => run(c, build(B.firmId, B, B)))).toBe(1);
    const err = await pgError(inFirm(app, A.firmId, (c) => run(c, build(A.firmId, A, B))));
    expect(err).toMatchObject({ code: "23503", message: expect.stringContaining(fk) });
  });
});
