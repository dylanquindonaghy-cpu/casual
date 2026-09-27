import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers, workers } from "./people";
import { firms } from "./tenancy";

// Login tables. Raw tokens and codes are never stored: only sha256 (tokens) or an HMAC (codes).
// kind says which subject a row belongs to, so a worker link or session can never be used as
// an office one (and the reverse).

export const SUBJECT_KINDS = ["worker", "office"] as const;

const subjectCheck = (
  name: string,
  kind: AnyPgColumn,
  workerId: AnyPgColumn,
  officeUserId: AnyPgColumn,
) =>
  check(
    name,
    sql`(${kind} = 'worker' and ${workerId} is not null and ${officeUserId} is null)
     or (${kind} = 'office' and ${officeUserId} is not null and ${workerId} is null)`,
  );

export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    kind: text("kind", { enum: SUBJECT_KINDS }).notNull(),
    workerId: uuid("worker_id"),
    officeUserId: uuid("office_user_id"),
    tokenHash: bytea("token_hash").notNull().unique(),
    // The login request this link answers. Makes the send job safe to retry.
    requestId: uuid("request_id").notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    sentAt: timestamptz("sent_at"),
    usedAt: timestamptz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "magic_links_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "magic_links_office_user_fk",
      columns: [t.firmId, t.officeUserId],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }).onDelete("cascade"),
    check("magic_links_kind_check", sql`${t.kind} in ('worker', 'office')`),
    subjectCheck("magic_links_subject_check", t.kind, t.workerId, t.officeUserId),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    kind: text("kind", { enum: SUBJECT_KINDS }).notNull(),
    workerId: uuid("worker_id"),
    officeUserId: uuid("office_user_id"),
    tokenHash: bytea("token_hash").notNull().unique(),
    // After rotation the previous token stays valid briefly, so parallel requests that still
    // carry the old cookie aren't logged out.
    prevTokenHash: bytea("prev_token_hash").unique(),
    prevValidUntil: timestamptz("prev_valid_until"),
    expiresAt: timestamptz("expires_at").notNull(),
    rotatedAt: timestamptz("rotated_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    // Set by a correct OTP; pay pages need it to be in the future.
    steppedUpUntil: timestamptz("stepped_up_until"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sessions_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "sessions_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sessions_office_user_fk",
      columns: [t.firmId, t.officeUserId],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }).onDelete("cascade"),
    check("sessions_kind_check", sql`${t.kind} in ('worker', 'office')`),
    subjectCheck("sessions_subject_check", t.kind, t.workerId, t.officeUserId),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const OTP_MAX_ATTEMPTS = 5;

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    sessionId: uuid("session_id").notNull(),
    codeHash: bytea("code_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamptz("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "otp_codes_session_fk",
      columns: [t.firmId, t.sessionId],
      foreignColumns: [sessions.firmId, sessions.id],
    }).onDelete("cascade"),
    // One live code per session: a new request retires the old code first.
    uniqueIndex("otp_codes_one_live_per_session")
      .on(t.sessionId)
      .where(sql`consumed_at is null`),
    check("otp_codes_attempts_range", sql`${t.attempts} between 0 and 5`),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Rate-limit counters. bucket is an HMAC of the number, email or IP, never the raw value.
export const authThrottle = pgTable(
  "auth_throttle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    bucket: text("bucket").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("auth_throttle_bucket_window_key").on(t.firmId, t.bucket, t.windowStart),
    firmIsolation(t.firmId),
  ],
).enableRLS();
