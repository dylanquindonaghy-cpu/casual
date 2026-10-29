import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, firmIsolation, timestamptz } from "./helpers";
import { firms } from "./tenancy";

// The secret store (P5.1; ADR-026): a firm's own credentials for its systems (its ops portal's API
// key and webhook secret; later its text system's), the first secrets a firm gives us. Each value
// is AES-256-GCM under SECRETS_KEY, a key only the worker's and the owner command's settings hold
// (src/lib/secrets/crypto.ts), with the firm and the name bound in, so a row copied to another
// firm or name never decrypts; a breach of the database alone reveals none of them.
//
// The app role has no rights on the table at all (TABLE_ACCESS []), so the web app can never read
// it. Rows are written only by the owner (npm run firm:secret), and read only through
// app_read_firm_secret(firm, name) (migration 0054), an owner-run function only the jobs role may
// call: the worker reads on a jobs-role connection of its own (src/lib/db/firm-secret.ts). Under
// forced RLS the owner reads rows through the owner-only policy below, as with api_keys.
export const firmSecrets = pgTable(
  "firm_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    // What it's for, as the code names it: "portal.api_key", "portal.webhook_secret".
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(), // the encrypted value with its 16-byte tag after it
    nonce: bytea("nonce").notNull(), // 12 random bytes, a new one for every value
    keyId: text("key_id").notNull(), // which SECRETS_KEY sealed it (the first 12 hex of its sha256)
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("firm_secrets_firm_id_id_key").on(t.firmId, t.id),
    unique("firm_secrets_name_key").on(t.firmId, t.name),
    check(
      "firm_secrets_name_format",
      sql`${t.name} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*){0,3}$'
      and char_length(${t.name}) <= 64`,
    ),
    check("firm_secrets_nonce_length", sql`octet_length(${t.nonce}) = 12`),
    // A tag (16 bytes) and at least one byte of value; at most 4 kB of value.
    check("firm_secrets_ciphertext_length", sql`octet_length(${t.ciphertext}) between 17 and 4112`),
    check("firm_secrets_key_id_format", sql`${t.keyId} ~ '^[0-9a-f]{12}$'`),
    firmIsolation(t.firmId),
    // The migrating owner may read them; app_read_firm_secret() runs as the owner. The app role has
    // no rights on the table, so no policy could show it anything.
    pgPolicy("secret_read", {
      as: "permissive",
      for: "select",
      to: "current_user",
      using: sql`true`,
    }),
  ],
).enableRLS();
