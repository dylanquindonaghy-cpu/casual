import { sql } from "drizzle-orm";
import { customType, pgPolicy, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

// Shared column and policy builders. Relative imports only: drizzle-kit loads these files itself.

// drizzle-orm 0.45 has no built-in bytea. Used for token and code hashes (never raw values).
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// Policy SQL is written into migrations as rendered text, so it must never contain bound values
// or "--". The (select ...) wrapper makes Postgres evaluate the firm once per query.
const currentFirm = sql`(select app_current_firm_id())`;

// The one tenant policy: a row is visible and writable only inside its own firm's transaction.
export const firmIsolation = (firmIdColumn: AnyPgColumn) =>
  pgPolicy("firm_isolation", {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`${firmIdColumn} = ${currentFirm}`,
    withCheck: sql`${firmIdColumn} = ${currentFirm}`,
  });

// Append-only tables (events) get read and insert policies only; there is no update/delete path.
export const firmIsolationAppendOnly = (firmIdColumn: AnyPgColumn) => [
  pgPolicy("firm_isolation_select", {
    as: "permissive",
    for: "select",
    to: "public",
    using: sql`${firmIdColumn} = ${currentFirm}`,
  }),
  pgPolicy("firm_isolation_insert", {
    as: "permissive",
    for: "insert",
    to: "public",
    withCheck: sql`${firmIdColumn} = ${currentFirm}`,
  }),
];
