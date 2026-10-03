import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { firms, sites } from "./tenancy";

// Links between firm tables use composite foreign keys (firm_id, x_id) -> parent (firm_id, id).
// Postgres checks foreign keys without RLS, so a plain FK would let one firm point a row at
// another firm's row. Links to firms(id) itself are fine: WITH CHECK pins firm_id.

export const OFFICE_ROLES = ["admin", "resourcer", "payroll"] as const;
export const WORKER_STATUSES = ["active", "inactive", "blocked"] as const;
// How the worker wants shift messages (Phase 4 notify job): WhatsApp, or text message. Login
// links and codes always go (the worker asked for them).
export const NOTIFY_CHANNELS = ["whatsapp", "sms"] as const;

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
    // Empty only once the worker is erased (below).
    mobileE164: text("mobile_e164"),
    email: text("email"),
    status: text("status", { enum: WORKER_STATUSES }).notNull().default("active"),
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // The person's id in the firm's own rota (a Google Sheet's staff id column), for syncing.
    // Null for workers who exist only here.
    externalRef: text("external_ref"),
    // The worker's own notification settings (the profile page).
    notifyChannel: text("notify_channel", { enum: NOTIFY_CHANNELS }).notNull().default("whatsapp"),
    offerAlerts: boolean("offer_alerts").notNull().default(true),
    // When they replied STOP to a text (Phase 7): no texts until they reply START (null: texts are
    // fine). Every sender reads it with the channel (src/lib/notify/send.ts).
    smsOptedOutAt: timestamptz("sms_opted_out_at"),
    // When the office made them inactive (Phase 10, src/lib/office/worker-access.ts). While set,
    // no rota sheet or file makes them active again (a blank sheet status reads as "active"):
    // only the office does, which clears it. Null: their status came from elsewhere.
    officeDeactivatedAt: timestamptz("office_deactivated_at"),
    // When the office erased their personal details (a GDPR deletion, Phase 8,
    // src/lib/gdpr/worker-erase.ts). The row stays, anonymous, because offers, bookings,
    // cancellations and pay lines point at it (the notice report's evidence).
    erasedAt: timestamptz("erased_at"),
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
    // A worker has a mobile until erased; an erased row is exactly this and nothing more.
    check(
      "workers_erased",
      sql`(${t.erasedAt} is null and ${t.mobileE164} is not null)
        or (${t.erasedAt} is not null and ${t.mobileE164} is null and ${t.email} is null
          and ${t.externalRef} is null and ${t.firstName} = 'Deleted' and ${t.lastName} = 'worker'
          and ${t.status} = 'inactive' and ${t.roles} = '{}' and ${t.smsOptedOutAt} is null)`,
    ),
    check("workers_status_check", sql`${t.status} in ('active', 'inactive', 'blocked')`),
    check("workers_notify_channel_check", sql`${t.notifyChannel} in ('whatsapp', 'sms')`),
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
    // Expiry warnings (src/lib/credentials/expiry.ts): the expiry date the warnings sent so far
    // were about, and the last threshold sent (30, 14 or 7 days). A new expiry date (a renewal)
    // means none sent yet for it.
    expiryWarnedFor: date("expiry_warned_for", { mode: "string" }),
    expiryWarnedDays: smallint("expiry_warned_days"),
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
    // Both set or both empty: a threshold is always about a particular expiry date.
    check(
      "credentials_expiry_warned_days",
      sql`(${t.expiryWarnedFor} is null) = (${t.expiryWarnedDays} is null) and ${t.expiryWarnedDays} in (30, 14, 7)`,
    ),
    check(
      "credentials_status_check",
      sql`${t.status} in ('valid', 'expired', 'applied', 'suspended')`,
    ),
    // A worker's credentials, read for every rules check (Phase 10: audit L74).
    index("credentials_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Days a worker has said they can't work (the profile page): one row per firm-local date. The
// rules engine's check 8 refuses a shift touching one (the office may override). The worker's own
// preference, not evidence, so it goes with the worker.
export const workerUnavailableDays = pgTable(
  "worker_unavailable_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("worker_unavailable_days_firm_id_id_key").on(t.firmId, t.id),
    unique("worker_unavailable_days_firm_id_worker_day_key").on(t.firmId, t.workerId, t.day),
    foreignKey({
      name: "worker_unavailable_days_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Why a worker is kept off a site (Phase 10): a code from a fixed list, so the action log never
// holds free text (the words: src/lib/office/worker-copy.ts).
export const SITE_BLOCK_REASONS = ["client_asked", "incident", "other"] as const;

// A site a worker may not work at (rules check 9, "blocked site": src/lib/rules/eligibility.ts).
// Added and removed by the office on the worker's page, each logged with its reason
// (`worker.site_blocked` / `worker.site_unblocked`); removing one deletes the row (the action log
// keeps the history).
export const workerSiteBlocks = pgTable(
  "worker_site_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    siteId: uuid("site_id").notNull(),
    reason: text("reason", { enum: SITE_BLOCK_REASONS }).notNull(),
    blockedBy: uuid("blocked_by"), // the office user who did it
    createdAt: createdAt(),
  },
  (t) => [
    unique("worker_site_blocks_firm_id_id_key").on(t.firmId, t.id),
    unique("worker_site_blocks_firm_id_worker_site_key").on(t.firmId, t.workerId, t.siteId),
    foreignKey({
      name: "worker_site_blocks_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "worker_site_blocks_site_fk",
      columns: [t.firmId, t.siteId],
      foreignColumns: [sites.firmId, sites.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "worker_site_blocks_blocked_by_fk",
      columns: [t.firmId, t.blockedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    check(
      "worker_site_blocks_reason_check",
      sql`${t.reason} in ('client_asked', 'incident', 'other')`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// A phone's web push address for a worker (the profile's "Turn on notifications"): the push
// service's endpoint and the browser's keys. One row per endpoint in a firm; a new login on the
// same phone moves it to that worker. Deleted with the worker, and when the push service says
// it's gone. Never logged (it addresses one person's phone).
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("push_subscriptions_firm_id_id_key").on(t.firmId, t.id),
    unique("push_subscriptions_firm_id_endpoint_key").on(t.firmId, t.endpoint),
    // A worker's phones, read for every push (Phase 10: audit L76).
    index("push_subscriptions_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    foreignKey({
      name: "push_subscriptions_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    check(
      "push_subscriptions_endpoint_https",
      sql`${t.endpoint} like 'https://%' and length(${t.endpoint}) <= 2048`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
