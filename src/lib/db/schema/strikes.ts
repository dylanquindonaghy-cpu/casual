import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers, workers } from "./people";
import { assignments, shifts } from "./roster";
import { firms } from "./tenancy";

// Strikes (12C.1; docs/office-v2.md 3.5, S4). A row only for a strike that was issued: a casual's
// own cancellation with less notice than the firm's strikes.notice_hours, on a booking they made
// themselves that nobody changed afterwards (src/lib/strikes/decide.ts). One per booking. It
// counts until expires_at (issued_at + strikes.live_days); "expired" is worked out from that date,
// never stored. The app may read and add rows and change only the review, withdrawal and evidence
// columns (COLUMN_UPDATES), never delete one: app_purge_old_strikes() (migration 0038), run as the
// owner by the nightly retention job, deletes rows older than strikes.keep_months (12), and none
// while the firm's retention hold is on.
//
// review_reasons ("unwell", "family_or_caring") come from the casual's quick reason and mark it for
// a person to look at; they're kept here, never in the action log. The withdrawal reason is the
// office's free text, cleared when the casual is erased. evidence_* is for the email to the
// strikes team (12C.4): empty until that job handles the strike.

export const STRIKE_STATUSES = ["live", "withdrawn"] as const;
export const STRIKE_REVIEW_REASONS = ["unwell", "family_or_caring"] as const;
export type StrikeReviewReason = (typeof STRIKE_REVIEW_REASONS)[number];
export const STRIKE_EVIDENCE_STATUSES = ["pending", "sent", "failed", "not_set_up"] as const;

export const strikes = pgTable(
  "strikes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    // The notice given (shift start minus the cancellation, as on the booking) and the firm's
    // threshold then: a strike always has less notice than its threshold.
    noticeHours: numeric("notice_hours", { precision: 8, scale: 2 }).notNull(),
    thresholdHours: integer("threshold_hours").notNull(),
    issuedAt: timestamptz("issued_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    status: text("status", { enum: STRIKE_STATUSES }).notNull().default("live"),
    reviewNeeded: boolean("review_needed").notNull().default(false),
    reviewReasons: text("review_reasons", { enum: STRIKE_REVIEW_REASONS })
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamptz("reviewed_at"),
    withdrawnBy: uuid("withdrawn_by"),
    withdrawnAt: timestamptz("withdrawn_at"),
    withdrawnReason: text("withdrawn_reason"),
    evidenceEmailStatus: text("evidence_email_status", { enum: STRIKE_EVIDENCE_STATUSES }),
    evidenceEmailTo: text("evidence_email_to"),
    evidenceEmailSentAt: timestamptz("evidence_email_sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("strikes_firm_id_id_key").on(t.firmId, t.id),
    // One strike per booking.
    unique("strikes_one_per_booking").on(t.firmId, t.assignmentId),
    foreignKey({
      name: "strikes_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "strikes_assignment_fk",
      columns: [t.firmId, t.assignmentId],
      foreignColumns: [assignments.firmId, assignments.id],
    }),
    foreignKey({
      name: "strikes_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    foreignKey({
      name: "strikes_reviewed_by_fk",
      columns: [t.firmId, t.reviewedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    foreignKey({
      name: "strikes_withdrawn_by_fk",
      columns: [t.firmId, t.withdrawnBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    index("strikes_firm_id_worker_id_idx").on(t.firmId, t.workerId, t.expiresAt),
    index("strikes_firm_id_issued_at_idx").on(t.firmId, t.issuedAt),
    check("strikes_status_check", sql`${t.status} in ('live', 'withdrawn')`),
    check(
      "strikes_review_reasons_check",
      sql`${t.reviewReasons} <@ array['unwell', 'family_or_caring']::text[]
        and (not ${t.reviewNeeded} or cardinality(${t.reviewReasons}) > 0)`,
    ),
    check(
      "strikes_notice_under_threshold",
      sql`${t.thresholdHours} > 0 and ${t.noticeHours} < ${t.thresholdHours}`,
    ),
    check("strikes_expires_after_issue", sql`${t.expiresAt} > ${t.issuedAt}`),
    check(
      "strikes_reviewed_together",
      sql`(${t.reviewedBy} is null) = (${t.reviewedAt} is null)`,
    ),
    // Withdrawn: by whom and when (the reason may later be cleared by an erasure). Live: neither.
    check(
      "strikes_withdrawn_together",
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} is not null)
        and (${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)
        and (${t.withdrawnReason} is null or length(${t.withdrawnReason}) between 1 and 500)`,
    ),
    check(
      "strikes_evidence_status_check",
      sql`${t.evidenceEmailStatus} is null
        or ${t.evidenceEmailStatus} in ('pending', 'sent', 'failed', 'not_set_up')`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
