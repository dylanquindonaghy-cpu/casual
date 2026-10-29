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
  // Events (docs/office-v2.md 3.3): added, never deleted, only hidden; the app may change only the
  // casuals switch and the name (COLUMN_UPDATES; the planner renames its own events, S11), so an
  // event's key, site and firm can't be rewritten.
  shift_events: ["SELECT", "INSERT"],
  shifts: NO_DELETE,
  assignments: NO_DELETE,
  requests: NO_DELETE,
  offers: NO_DELETE,
  // Each reminder a booking got (or why not): evidence in a no-show dispute.
  shift_reminders: NO_DELETE,
  metrics_daily: NO_DELETE, // pilot figures: corrected, never removed (the week-4 report's evidence)
  // A firm's sheet: connected, replaced and switched off only by the owner (npm run firm:sheet),
  // so no screen can point a firm at another firm's sheet (audit L45). The app reads it, and the
  // sync updates only its status columns (COLUMN_UPDATES).
  roster_sources: ["SELECT"],
  // A firm's name map (P3.2): set only by the owner (npm run firm:names), read by the sheet sync
  // and the file import.
  name_map: ["SELECT"],
  // Imported payroll lines: added and corrected by re-import, never deleted by the app (they are
  // what a pay question is checked against).
  pay_records: NO_DELETE,
  pay_queries: NO_DELETE, // resolved, never removed (what payroll answered is evidence)
  // The worker marks and clears days they can't work (logged as events); a day is never edited.
  worker_unavailable_days: ["SELECT", "INSERT", "DELETE"],
  // The shifts line's messages in and out: handled, never deleted by the app (what a worker asked
  // and what they were told). Kept for the firm's retention.message_days (90 by default).
  messages: NO_DELETE,
  // A phone's push address: saved, moved to a new login on the same phone, removed.
  push_subscriptions: CRUD,
  // A site a worker may not work at: added and removed by the office (both logged), never edited.
  worker_site_blocks: ["SELECT", "INSERT", "DELETE"],
  // Strikes (12C.1): issued, then reviewed, withdrawn or emailed (COLUMN_UPDATES), never rewritten
  // or deleted by the app; app_purge_old_strikes() deletes them at strikes.keep_months.
  strikes: ["SELECT", "INSERT"],
  // A casual's travel area (12G.1, S8): saved, changed and removed by the casual; deleted when the
  // office makes them inactive as "They've left" and when they're erased. Only the area's own
  // columns change (COLUMN_UPDATES): never whose it is or which firm's.
  worker_travel: ["SELECT", "INSERT", "DELETE"],
  // Travel estimates (12G.2, S9): added and refreshed by the travel job (COLUMN_UPDATES: the result
  // and its expiry only), deleted when a site's postcode changes and by the retention purge.
  travel_estimates: ["SELECT", "INSERT", "DELETE"],
  // Photos and certificate images (12F.2, S7): sent by a casual, checked by the office
  // (COLUMN_UPDATES: the check only, never the bytes or whose they are), deleted when replaced
  // while waiting, by the retention purge and on erasure.
  uploads: ["SELECT", "INSERT", "DELETE"],
  // The planner's API keys (S11, 12J.1): read and added; last use and revocation only through
  // COLUMN_UPDATES, so a key's hash and label can never be rewritten; never deleted.
  api_keys: ["SELECT", "INSERT"],
  // A firm's own credentials (P5.1; ADR-026): none at all. Written by the owner command, read by
  // the worker only through app_read_firm_secret(), as the jobs role.
  firm_secrets: [],
};

// Columns the app role may update on a table it can't update as a whole (a column-level grant).
export const COLUMN_UPDATES: Readonly<Record<string, readonly string[]>> = {
  roster_sources: ["last_synced_at", "last_attempted_at", "last_error_code", "sync_started_at"],
  shift_events: ["showing_to_casuals", "name"],
  // The planner's API keys (S11): read and added, never rewritten or deleted; only the last use
  // and the revocation change.
  api_keys: ["last_used_at", "revoked_at", "revoked_by"],
  strikes: [
    "review_needed",
    "reviewed_by",
    "reviewed_at",
    "status",
    "withdrawn_by",
    "withdrawn_at",
    "withdrawn_reason",
    "evidence_email_status",
    "evidence_email_to",
    "evidence_email_sent_at",
  ],
  worker_travel: [
    "start_postcode",
    "lat",
    "lng",
    "modes",
    "max_minutes",
    "privacy_notice_version",
    "updated_at",
  ],
  travel_estimates: ["minutes", "metres", "provider", "computed_at", "expires_at"],
  uploads: ["status", "checked_by", "checked_at", "reject_reason"],
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
  const stale = [...Object.keys(TABLE_ACCESS), ...Object.keys(COLUMN_UPDATES)].filter(
    (t) => !inDb.includes(t),
  );
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
    // Revoking on the table revokes its column-level grants too, so this resets both.
    await client.query(`revoke all on ${t} from public, ${app}, ${jobs}`);
    if (privileges.length > 0) {
      await client.query(`grant ${privileges.join(", ")} on ${t} to ${app}`);
    }
    const columns = COLUMN_UPDATES[table];
    if (columns) {
      if (privileges.includes("UPDATE")) {
        throw new Error(`${table}: COLUMN_UPDATES on a table the app can already update`);
      }
      const list = columns.map((c) => client.escapeIdentifier(c)).join(", ");
      await client.query(`grant update (${list}) on ${t} to ${app}`);
    }
  }
}
