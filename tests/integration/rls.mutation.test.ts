import type { ClientBase, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuserPool } from "../helpers/db";
import { countById } from "../helpers/rls-probe";
import { createTenant, EXPECTED_TABLES, type TableName, type Tenant } from "../helpers/tenant-rows";

// Proves the isolation probes can fail. For every table, the same cross-firm read that
// tenancy.isolation expects to return 0 is run with the protection deliberately broken (a
// policy that allows everything, RLS switched off, or a superuser connection), and must then see
// Firm B's row. Each break happens inside a transaction that is rolled back.

let su: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool(1);
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

async function policySnapshot(): Promise<string> {
  const { rows } = await su.query(
    `select tablename, policyname, permissive, roles::text, cmd, qual, with_check
       from pg_policies where schemaname = 'public' order by 1, 2`,
  );
  return JSON.stringify(rows);
}

// Firm A's view of Firm B's row, after `breakIt` has run in the same rolled-back transaction.
async function crossFirmRead(
  table: TableName,
  breakIt: (client: ClientBase) => Promise<void>,
): Promise<number> {
  const client = await su.connect();
  try {
    await client.query("begin");
    await breakIt(client);
    await client.query("select set_config('app.current_firm_id', $1, true)", [A.firmId]);
    return await countById(client, table, B.rows[table]);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

const asApp = (client: ClientBase) =>
  client.query("set local role shiftdesk_app").then(() => undefined);

describe.each(EXPECTED_TABLES)("%s", (table) => {
  it("the probe sees nothing when the protection is intact (control)", async () => {
    expect(await crossFirmRead(table, asApp)).toBe(0);
  });

  it("the probe catches a policy that lets every row through", async () => {
    const before = await policySnapshot();
    const seen = await crossFirmRead(table, async (client) => {
      const { rows } = await client.query<{ policyname: string; cmd: string }>(
        "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = $1",
        [table],
      );
      for (const p of rows) {
        if (p.policyname === "directory_read") continue; // not the app's policy
        if (p.cmd === "INSERT") continue; // has no USING clause
        const name = client.escapeIdentifier(p.policyname);
        await client.query(
          `alter policy ${name} on public.${client.escapeIdentifier(table)} using (true)`,
        );
      }
      await asApp(client);
    });
    expect(seen).toBe(1);
    expect(await policySnapshot()).toBe(before); // rolled back
  });

  it("the probe catches RLS being switched off", async () => {
    const seen = await crossFirmRead(table, async (client) => {
      await client.query(
        `alter table public.${client.escapeIdentifier(table)} disable row level security`,
      );
      await asApp(client);
    });
    expect(seen).toBe(1);
    const { rows } = await su.query<{ on: boolean }>(
      "select relrowsecurity as on from pg_class where oid = $1::regclass",
      [`public.${table}`],
    );
    expect(rows[0]?.on).toBe(true); // rolled back
  });

  it("the probe catches a connection that bypasses RLS (superuser)", async () => {
    expect(await crossFirmRead(table, async () => undefined)).toBe(1);
  });
});
