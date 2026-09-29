import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { ClientBase } from "pg";
import { APP_DB_ROLE, JOBS_DB_ROLE } from "../../env";
import * as schema from "../schema";

// What the app role may do on each table. drizzle-kit never writes FORCE ROW LEVEL SECURITY or
// GRANTs, so db:migrate applies this map after the migrations. Every table must have an entry:
// a new table without one fails the migrate (and rls.every-table).
// Never grant TRUNCATE (it ignores RLS) or UPDATE/DELETE on events (append-only).

export type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
const CRUD: readonly Privilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
// Evidence tables: rows change state (cancelled, resolved, responded) but are never deleted by
// the app, so the notice report can't lose history (golden rules 5 and 12).
const NO_DELETE: readonly Privilege[] = ["SELECT", "INSERT", "UPDATE"];

export const TABLE_ACCESS: Readonly<Record<string, readonly Privilege[]>> = {
  // Firms are created by an admin script. No Phase 1 feature edits a firm.
  firms: ["SELECT"],
  sites: CRUD,
  office_users: CRUD,
  workers: CRUD,
  credentials: CRUD,
  events: ["SELECT", "INSERT"],
  magic_links: CRUD,
  sessions: CRUD,
  otp_codes: CRUD,
  auth_throttle: CRUD,
  // The office edits which credentials a role needs (logged as events).
  credential_rules: CRUD,
  // Seeded from a pack; the office may add or rename types (logged as events, applied_allowed
  // changes especially: they change who may work).
  credential_types: CRUD,
  shifts: NO_DELETE,
  assignments: NO_DELETE,
  requests: NO_DELETE,
  offers: NO_DELETE,
  // Each reminder a booking got (or why not): evidence in a no-show dispute.
  shift_reminders: NO_DELETE,
  metrics_daily: NO_DELETE, // pilot figures: corrected, never removed (the week-4 report's evidence)
  // Sheet connection settings (office settings later; the sync updates its status columns).
  roster_sources: CRUD,
  // Imported payroll lines: added and corrected by re-import, never deleted by the app (they are
  // what a pay question is checked against).
  pay_records: NO_DELETE,
  pay_queries: NO_DELETE, // resolved, never removed (what payroll answered is evidence)
  // The worker marks and clears days they can't work (logged as events); a day is never edited.
  worker_unavailable_days: ["SELECT", "INSERT", "DELETE"],
  // The shifts line's messages in and out: handled, never deleted by the app (what a worker asked
  // and what they were told). Kept 90 days (retention, Phase 8).
  messages: NO_DELETE,
  // A phone's push address: saved, moved to a new login on the same phone, removed.
  push_subscriptions: CRUD,
};

export function schemaTableNames(): string[] {
  return Object.values(schema as Record<string, unknown>)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableName(table))
    .sort();
}

// Enables and forces RLS (so the owner is bound by policies too) and resets the app role's grants
// to exactly what TABLE_ACCESS says. Idempotent; runs as the owner on every migrate.
export async function applyTableSecurity(client: ClientBase): Promise<void> {
  const { rows } = await client.query<{ name: string }>(
    `select c.relname as name from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      order by 1`,
  );
  const inDb = rows.map((r) => r.name);
  const missing = inDb.filter((t) => !(t in TABLE_ACCESS));
  const stale = Object.keys(TABLE_ACCESS).filter((t) => !inDb.includes(t));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `TABLE_ACCESS is out of date. No entry for: [${missing.join(", ")}]. ` +
        `Entry but no table: [${stale.join(", ")}]. Edit src/lib/db/admin/access.ts.`,
    );
  }

  // Never hand the app a table that has no policy: with RLS on it would see nothing (fine), but
  // with RLS forgotten it would see everything. So every table must have one, and RLS is
  // (re-)enabled here as well as forced.
  const { rows: unpoliced } = await client.query<{ name: string }>(
    `select c.relname as name from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`,
  );
  if (unpoliced.length > 0) {
    throw new Error(
      `Tables with no RLS policy: ${unpoliced.map((r) => r.name).join(", ")}. ` +
        "Add the tenant policy in src/lib/db/schema.",
    );
  }

  const app = client.escapeIdentifier(APP_DB_ROLE);
  const jobs = client.escapeIdentifier(JOBS_DB_ROLE);
  for (const table of inDb) {
    const t = `public.${client.escapeIdentifier(table)}`;
    const privileges = TABLE_ACCESS[table] ?? [];
    await client.query(`alter table ${t} enable row level security`);
    await client.query(`alter table ${t} force row level security`);
    await client.query(`revoke all on ${t} from public, ${app}, ${jobs}`);
    await client.query(`grant ${privileges.join(", ")} on ${t} to ${app}`);
  }
}
