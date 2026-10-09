import { sql } from "drizzle-orm";
import { check, date, foreignKey, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers } from "./people";
import { firms } from "./tenancy";

// Pilot metrics (Phase 5, docs/pilot-playbook.md, docs/data-model.md): one number per firm, kind,
// day and metric.
// - baseline: the playbook's week-0 figures, entered by the office (day: the baseline week's
//   first day);
// - tally: the office's own weekly count of emails, calls and WhatsApp messages, and resourcer
//   hours, which the app can't see (day: that week's Monday);
// - daily: the nightly rollup's counts for one firm-local day (src/lib/metrics/rollup.ts),
//   recomputed for the last 7 days each night.
// Figures only: no names or personal data. The app may add and correct them but not delete them
// (they're the week-4 report's evidence).

export const METRIC_KINDS = ["baseline", "tally", "daily"] as const;

export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    day: date("day", { mode: "string" }).notNull(),
    kind: text("kind", { enum: METRIC_KINDS }).notNull(),
    metric: text("metric").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }).notNull(),
    // The office user who entered a baseline or tally figure; none for the rollup's.
    recordedBy: uuid("recorded_by"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("metrics_daily_firm_id_id_key").on(t.firmId, t.id),
    unique("metrics_daily_one_key").on(t.firmId, t.kind, t.day, t.metric),
    foreignKey({
      name: "metrics_daily_recorded_by_fk",
      columns: [t.firmId, t.recordedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    check("metrics_daily_kind_check", sql`${t.kind} in ('baseline', 'tally', 'daily')`),
    check("metrics_daily_metric_check", sql`${t.metric} ~ '^[a-z][a-z_]{0,59}$'`),
    check("metrics_daily_value_check", sql`${t.value} >= 0`),
    check("metrics_daily_recorded_by", sql`(${t.kind} = 'daily') = (${t.recordedBy} is null)`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
