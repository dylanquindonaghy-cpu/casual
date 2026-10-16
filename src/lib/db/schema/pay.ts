import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { shifts } from "./roster";
import { firms } from "./tenancy";

// Pay records (Phase 3, docs/data-model.md): hours, rates and pay dates imported from the firm's
// payroll, shown to the worker behind the pay-page code. The figures are the firm's, never worked
// out here (golden rules 1 and 9). One line per worker, pay period and rate (a week can have a day
// and a night rate); re-importing the same line updates it. The app may add and correct records
// but not delete them: they are what a pay question is checked against (removal and GDPR
// deletion are for Phases 6 and 8), so the worker link has no ON DELETE action either.

export const PAY_RECORD_SOURCES = ["import"] as const;

export const payRecords = pgTable(
  "pay_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    ratePence: integer("rate_pence").notNull(),
    grossPence: integer("gross_pence"),
    payDate: date("pay_date", { mode: "string" }),
    source: text("source", { enum: PAY_RECORD_SOURCES }).notNull().default("import"),
    updatedAt: timestamptz("updated_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("pay_records_firm_id_id_key").on(t.firmId, t.id),
    unique("pay_records_firm_id_line_key").on(
      t.firmId,
      t.workerId,
      t.periodStart,
      t.periodEnd,
      t.ratePence,
    ),
    foreignKey({
      name: "pay_records_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    index("pay_records_firm_id_worker_id_period_end_idx").on(t.firmId, t.workerId, t.periodEnd),
    check("pay_records_period_order", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("pay_records_hours_range", sql`${t.hours} >= 0 and ${t.hours} <= 1000`),
    check("pay_records_rate_nonnegative", sql`${t.ratePence} >= 0`),
    check("pay_records_gross_nonnegative", sql`${t.grossPence} >= 0`),
    check("pay_records_source_check", sql`${t.source} in ('import')`),
    firmIsolation(t.firmId),
  ],
).enableRLS();

// Pay queries (Phase 6, docs/architecture.md "Pay query"): a worker's structured question about
// their pay, raised behind the pay-page code (src/lib/portal/pay-queries.ts). The day worked is
// always set (the shift's day, or the day they typed); the shift only if they picked one. Their
// details are free text: kept here, never copied into events. group_key is set by code when the
// queries are grouped for payroll's digest (no AI decides anything about pay: golden rule 9).
// The app may resolve queries but not delete them. Payroll sorts them with a note to the worker
// (resolution_note: free text, on the row and on their pay page, behind the pay code: never in the
// message to them, 13.4, nor in an event), who and when (src/lib/pay/resolve.ts).

export const PAY_QUERY_ISSUES = ["missing_hours", "wrong_rate", "late_pay", "other"] as const;
export const PAY_QUERY_STATUSES = ["open", "in_digest", "resolved"] as const;

export const payQueries = pgTable(
  "pay_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    workerId: uuid("worker_id").notNull(),
    shiftId: uuid("shift_id"),
    workDate: date("work_date", { mode: "string" }).notNull(),
    issueType: text("issue_type", { enum: PAY_QUERY_ISSUES }).notNull(),
    details: text("details"),
    groupKey: text("group_key"),
    status: text("status", { enum: PAY_QUERY_STATUSES }).notNull().default("open"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamptz("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("pay_queries_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "pay_queries_resolved_by_fk",
      columns: [t.firmId, t.resolvedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    foreignKey({
      name: "pay_queries_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "pay_queries_shift_fk",
      columns: [t.firmId, t.shiftId],
      foreignColumns: [shifts.firmId, shifts.id],
    }),
    index("pay_queries_firm_id_status_idx").on(t.firmId, t.status),
    index("pay_queries_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    check(
      "pay_queries_issue_type_check",
      sql`${t.issueType} in ('missing_hours', 'wrong_rate', 'late_pay', 'other')`,
    ),
    check("pay_queries_status_check", sql`${t.status} in ('open', 'in_digest', 'resolved')`),
    check(
      "pay_queries_details_length",
      sql`${t.details} is null or char_length(${t.details}) between 1 and 1000`,
    ),
    // Only a sorted query carries who sorted it, when, and payroll's short note.
    check(
      "pay_queries_resolution",
      sql`${t.status} = 'resolved'
        or (${t.resolvedAt} is null and ${t.resolvedBy} is null and ${t.resolutionNote} is null)`,
    ),
    check(
      "pay_queries_resolution_note_length",
      sql`${t.resolutionNote} is null or char_length(${t.resolutionNote}) between 1 and 500`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
