import { sql } from "drizzle-orm";
import { check, foreignKey, pgPolicy, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers } from "./people";
import { firms } from "./tenancy";

// API keys for the firm's planner (S11, 12J.1; docs/office-v2.md 5.3.2; ADR-022). A key is
// `shiftdesk_` plus 43 random characters, shown once; only its sha256 and its last 4 characters
// are kept. The app may read and add rows and change only last_used_at and the revocation
// (TABLE_ACCESS, COLUMN_UPDATES): it can never rewrite a key's hash or label, and a row is never
// deleted (its id is the actor on every change the key made). A revocation is final: a trigger
// (migration 0046) refuses any later UPDATE of revoked_at or revoked_by, whoever runs it (only a
// migration, as the owner, could drop the trigger). Left out of the firm's export.
//
// app_api_key_lookup(hash) (migration 0045), run as the owner, finds a live key's firm before any
// firm is known; under forced RLS the owner reads rows only through the owner-only policy below.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    label: text("label").notNull(),
    tokenHash: bytea("token_hash").notNull().unique(),
    hint: text("hint").notNull(),
    createdBy: uuid("created_by").notNull(),
    revokedBy: uuid("revoked_by"),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("api_keys_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "api_keys_created_by_fk",
      columns: [t.firmId, t.createdBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    foreignKey({
      name: "api_keys_revoked_by_fk",
      columns: [t.firmId, t.revokedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    check(
      "api_keys_label_length",
      sql`char_length(${t.label}) between 1 and 60 and ${t.label} = btrim(${t.label})`,
    ),
    check("api_keys_hint_format", sql`${t.hint} ~ '^[A-Za-z0-9_-]{4}$'`),
    check("api_keys_token_hash_length", sql`octet_length(${t.tokenHash}) = 32`),
    check("api_keys_revoked_together", sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
    firmIsolation(t.firmId),
    // The migrating owner may read keys; app_api_key_lookup() runs as the owner. The app role
    // gets no such policy: it only sees its own firm's keys.
    pgPolicy("key_lookup", {
      as: "permissive",
      for: "select",
      to: "current_user",
      using: sql`true`,
    }),
  ],
).enableRLS();

// The planner's webhook status (Phase 25.3; P4's "the webhook status from a small row"): one row per
// firm, so the Integrations page and Needs attention read it at once instead of searching the
// action log. Written in the transaction that logs what it sums up (src/lib/integrations/status.ts):
// the address set (addWebhook: a fresh start), a delivery (`webhook.delivered`: no
// longer failing) and a last try that failed (`webhook.failed`: failing since the first). Times
// only, no address or personal data. The app may add a row and change its times (COLUMN_UPDATES),
// never whose it is; the action log stays the record.
export const webhookStatus = pgTable(
  "webhook_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    addressSetAt: timestamptz("address_set_at").notNull(), // when the address was last set
    lastDeliveredAt: timestamptz("last_delivered_at"), // the last delivery that worked since then
    failingSince: timestamptz("failing_since"), // the first last-try failure since a delivery
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [unique("webhook_status_firm_id_key").on(t.firmId), firmIsolation(t.firmId)],
).enableRLS();
