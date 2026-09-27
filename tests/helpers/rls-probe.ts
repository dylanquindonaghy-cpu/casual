import type { ClientBase, Pool } from "pg";
import type { Statement, TableName } from "./tenant-rows";

// Low-level probes shared by tenancy.isolation and rls.mutation, so the mutation test proves
// that these exact probes notice a leak.

export class Rollback extends Error {}

// Runs fn on one connection inside a transaction with app.current_firm_id set (or not set, for
// firmId null) exactly as withFirm does. Rolls back unless commit is true.
export async function inFirm<T>(
  pool: Pool,
  firmId: string | null,
  fn: (client: ClientBase) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (firmId) await client.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
    const result = await fn(client);
    await client.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function countById(client: ClientBase, table: TableName, id: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from public.${client.escapeIdentifier(table)} where id = $1`,
    [id],
  );
  return result.rows[0]?.n ?? -1;
}

export async function countAll(client: ClientBase, table: TableName): Promise<number> {
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from public.${client.escapeIdentifier(table)}`,
  );
  return result.rows[0]?.n ?? -1;
}

export async function touchById(client: ClientBase, table: TableName, id: string): Promise<number> {
  const result = await client.query(
    `update public.${client.escapeIdentifier(table)} set created_at = created_at where id = $1`,
    [id],
  );
  return result.rowCount ?? -1;
}

export async function deleteById(
  client: ClientBase,
  table: TableName,
  id: string,
): Promise<number> {
  const result = await client.query(
    `delete from public.${client.escapeIdentifier(table)} where id = $1`,
    [id],
  );
  return result.rowCount ?? -1;
}

export async function run(client: ClientBase, statement: Statement): Promise<number> {
  const result = await client.query(statement.text, statement.values);
  return result.rowCount ?? -1;
}

// The Postgres error a promise rejected with, for exact code/message assertions. drizzle wraps
// driver errors, so the SQLSTATE may be on the error's cause.
export async function pgError(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
      const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof code === "string") return { code, message: String(message) };
      e = cause;
    }
    return { code: "none", message: String(err) };
  }
  throw new Error("expected the statement to fail, but it succeeded");
}
