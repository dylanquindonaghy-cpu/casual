import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, createdAt, firmIsolation, timestamptz } from "./helpers";
import {
  TRAVEL_MINUTES,
  TRAVEL_MODES,
  type TravelMinutes,
  type TravelMode,
} from "../../travel/modes";
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

// Photos and certificate images (docs/office-v2.md 5.5; S7, D3; 12F.2), stored in Postgres so
// row-level security, erasure and export cover them. Always a JPEG re-encoded by the server
// (src/lib/uploads/image.ts: no location or other hidden data), 1 MB at most. A casual sends them;
// a named office person checks each one (approved or rejected with a reason code). The current
// staff photo is the latest approved one (src/lib/uploads/photo.ts), so workers has no photo
// column. One waiting upload per casual per kind and type: a new one replaces it. The app may add,
// check (COLUMN_UPDATES) and delete them (a replaced one, the retention purge, erasure), never
// rewrite the bytes or whose they are. The JSON exports carry the details, never the bytes.
export const UPLOAD_KINDS = ["photo", "certificate"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export const UPLOAD_STATUSES = ["waiting", "approved", "rejected"] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
// Why the office didn't accept one (docs/office-v2.md 3.7): codes, never typed words.
export const REJECT_REASONS = [
  "blurry",
  "wrong_document",
  "expired",
  "doesnt_match",
  "other",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export const UPLOAD_MAX_STORED_BYTES = 1_000_000;
const reasonList = sql.raw(REJECT_REASONS.map((r) => `'${r}'`).join(", "));

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    kind: text("kind", { enum: UPLOAD_KINDS }).notNull(),
    // A certificate's qualification type code (data, as credentials.type); null for a photo.
    credentialType: text("credential_type"),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(), // hex: the fingerprint the exports carry
    data: bytea("data").notNull(),
    uploadedBy: text("uploaded_by", { enum: ["casual"] })
      .notNull()
      .default("casual"),
    status: text("status", { enum: UPLOAD_STATUSES }).notNull().default("waiting"),
    checkedBy: uuid("checked_by"),
    checkedAt: timestamptz("checked_at"),
    rejectReason: text("reject_reason", { enum: REJECT_REASONS }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("uploads_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "uploads_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "uploads_checked_by_fk",
      columns: [t.firmId, t.checkedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    // One waiting at a time per casual, kind and type.
    uniqueIndex("uploads_one_waiting")
      .on(t.firmId, t.workerId, t.kind, sql`coalesce(${t.credentialType}, '')`)
      .where(sql`${t.status} = 'waiting'`),
    // "Uploads to check", oldest first; and a casual's own, newest first.
    index("uploads_firm_id_status_idx").on(t.firmId, t.status, t.createdAt),
    index("uploads_firm_id_worker_idx").on(t.firmId, t.workerId, t.kind, t.createdAt),
    check("uploads_kind_check", sql`${t.kind} in ('photo', 'certificate')`),
    check(
      "uploads_type_check",
      sql`(${t.kind} = 'photo' and ${t.credentialType} is null)
        or (${t.kind} = 'certificate' and ${t.credentialType} ~ '^[A-Z][A-Z0-9_]*$')`,
    ),
    check("uploads_content_type_check", sql`${t.contentType} = 'image/jpeg'`),
    check(
      "uploads_size_check",
      sql`${t.size} = octet_length(${t.data}) and ${t.size} between 1 and ${sql.raw(String(UPLOAD_MAX_STORED_BYTES))}`,
    ),
    check("uploads_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("uploads_uploaded_by_check", sql`${t.uploadedBy} = 'casual'`),
    check("uploads_status_check", sql`${t.status} in ('waiting', 'approved', 'rejected')`),
    // Checked means by someone, at a time; rejected means with a reason, and only then.
    check(
      "uploads_checked",
      sql`(${t.status} = 'waiting') = (${t.checkedAt} is null)
        and (${t.status} = 'waiting') = (${t.checkedBy} is null)
        and (${t.status} = 'rejected') = (${t.rejectReason} is not null)
        and (${t.rejectReason} is null or ${t.rejectReason} in (${reasonList}))`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// A qualification record's check (S6; 12F.2): "verified" is the office's own (imported, recorded,
// or an upload a named person approved); "waiting" and "rejected" are a casual's upload not
// (yet) accepted. Only verified records count anywhere: every reader filters on it, and an
// unchecked record is stored as expired (credentials_unchecked_never_valid), so a reader that
// missed the filter still couldn't count it.
export const CHECK_STATES = ["verified", "waiting", "rejected"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

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
    checkState: text("check_state", { enum: CHECK_STATES }).notNull().default("verified"),
    rejectedReason: text("rejected_reason", { enum: REJECT_REASONS }),
    // The upload it came from (a casual's certificate image), if any.
    evidenceUploadId: uuid("evidence_upload_id"),
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
    foreignKey({
      name: "credentials_evidence_upload_fk",
      columns: [t.firmId, t.evidenceUploadId],
      foreignColumns: [uploads.firmId, uploads.id],
    }),
    check(
      "credentials_check_state_check",
      sql`${t.checkState} in ('verified', 'waiting', 'rejected')
        and (${t.checkState} = 'rejected') = (${t.rejectedReason} is not null)
        and (${t.rejectedReason} is null or ${t.rejectedReason} in (${reasonList}))`,
    ),
    // An unchecked record never reads as held, and always has the upload it's waiting on.
    check(
      "credentials_unchecked_never_valid",
      sql`${t.checkState} = 'verified'
        or (${t.status} = 'expired' and ${t.evidenceUploadId} is not null)`,
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

// A casual's travel area (docs/office-v2.md 4.6, 5.4; S8; 12G.1): where they start from (a postcode,
// which can differ from home, and its central point: never a house number, GPS or movement), how
// they travel and their time limit. Set on /profile/travel; one row per casual. A table of its own,
// so the erased-worker check above is unchanged. The office sees the district only ("ZZ1"). Deleted
// when the office makes them inactive as "They've left" and when they're erased; in their export.
// Never in the log (travel.profile_changed names what changed and the time limit only).
export { TRAVEL_MINUTES, TRAVEL_MODES, type TravelMinutes, type TravelMode };

export const workerTravel = pgTable(
  "worker_travel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    startPostcode: text("start_postcode").notNull(), // tidy: "ZZ1 1AA"
    lat: numeric("lat", { precision: 9, scale: 6 }).notNull(),
    lng: numeric("lng", { precision: 9, scale: 6 }).notNull(),
    modes: text("modes", { enum: TRAVEL_MODES }).notNull(),
    maxMinutes: integer("max_minutes").notNull(),
    // The wording of the page's privacy line they saw when they saved (TRAVEL_NOTICE_VERSION).
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("worker_travel_firm_id_id_key").on(t.firmId, t.id),
    unique("worker_travel_one_per_worker").on(t.firmId, t.workerId),
    foreignKey({
      name: "worker_travel_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    check(
      "worker_travel_postcode_check",
      sql`${t.startPostcode} ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'`,
    ),
    check(
      "worker_travel_point_check",
      sql`${t.lat} between -90 and 90 and ${t.lng} between -180 and 180`,
    ),
    check("worker_travel_modes_check", sql`${t.modes} in ('car', 'public_transport', 'both')`),
    check("worker_travel_minutes_check", sql`${t.maxMinutes} in (30, 45, 60, 90)`),
    check("worker_travel_notice_check", sql`length(${t.privacyNoticeVersion}) between 1 and 40`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
