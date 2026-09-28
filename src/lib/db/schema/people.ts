import { sql } from "drizzle-orm";
import { check, date, foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { firms } from "./tenancy";

// Links between firm tables use composite foreign keys (firm_id, x_id) -> parent (firm_id, id).
// Postgres checks foreign keys without RLS, so a plain FK would let one firm point a row at
// another firm's row. Links to firms(id) itself are fine: WITH CHECK pins firm_id.

export const OFFICE_ROLES = ["admin", "resourcer", "payroll"] as const;
export const WORKER_STATUSES = ["active", "inactive", "blocked"] as const;

export const officeUsers = pgTable(
  "office_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: OFFICE_ROLES }).notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("office_users_firm_id_id_key").on(t.firmId, t.id),
    unique("office_users_firm_id_email_key").on(t.firmId, t.email),
    check(
      "office_users_email_lower",
      sql`${t.email} = lower(${t.email}) and ${t.email} ~ '^[^@ ]+@[^@ ]+$'`,
    ),
    check("office_users_role_check", sql`${t.role} in ('admin', 'resourcer', 'payroll')`),
    check("office_users_status_check", sql`${t.status} in ('active', 'disabled')`),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const workers = pgTable(
  "workers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    mobileE164: text("mobile_e164").notNull(),
    email: text("email"),
    status: text("status", { enum: WORKER_STATUSES }).notNull().default("active"),
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // The person's id in the firm's own rota (a Google Sheet's staff id column), for syncing.
    // Null for workers who exist only here.
    externalRef: text("external_ref"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("workers_firm_id_id_key").on(t.firmId, t.id),
    unique("workers_firm_id_mobile_key").on(t.firmId, t.mobileE164),
    unique("workers_firm_id_external_ref_key").on(t.firmId, t.externalRef),
    check(
      "workers_external_ref_format",
      sql`${t.externalRef} = btrim(${t.externalRef}) and length(${t.externalRef}) between 1 and 200`,
    ),
    check("workers_mobile_e164_check", sql`${t.mobileE164} ~ '^[+][1-9][0-9]{6,14}$'`),
    check("workers_status_check", sql`${t.status} in ('active', 'inactive', 'blocked')`),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    // Credential type codes are data (docs/rules-and-credentials.md), never an enum of SIA types.
    type: text("type").notNull(),
    number: text("number"),
    expiresOn: date("expires_on", { mode: "string" }),
    status: text("status", { enum: ["valid", "expired", "applied", "suspended"] })
      .notNull()
      .default("valid"),
    verifiedAt: timestamptz("verified_at"),
    verifiedBy: uuid("verified_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "credentials_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    // Office users are disabled, never deleted, so no ON DELETE action is needed here.
    foreignKey({
      name: "credentials_verified_by_fk",
      columns: [t.firmId, t.verifiedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    check("credentials_type_format", sql`${t.type} ~ '^[A-Z][A-Z0-9_]*$'`),
    check(
      "credentials_status_check",
      sql`${t.status} in ('valid', 'expired', 'applied', 'suspended')`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
