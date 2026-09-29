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
import { workers } from "./people";
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
