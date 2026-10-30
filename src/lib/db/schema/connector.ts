import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { rosterSources } from "./roster";
import { firms } from "./tenancy";

// What a connector's source said changed (P5.3; src/lib/connector/): one row per event the source
// sent, unique by the source's own event id (golden rule 3: the same webhook twice is one row and
// one job), with what changed (a session or a staff record, by the source's ref) and what the job
// made of it. Nothing of the record itself: the job reads it from the source's API, never from the
// webhook's body. Written by the webhook (the app role inserts) and the job (it updates the outcome).
export const CONNECTOR_EVENT_STATUSES = [
  "queued",
  "applied",
  "refused",
  "ignored",
  "failed",
] as const;
export type ConnectorEventStatus = (typeof CONNECTOR_EVENT_STATUSES)[number];

export const connectorEvents = pgTable(
  "connector_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    sourceId: uuid("source_id").notNull(),
    eventId: text("event_id").notNull(), // the source's own (its webhook-id)
    type: text("type", { enum: ["session.changed", "staff.changed"] }).notNull(),
    ref: text("ref").notNull(), // the source's ref for the session or staff record
    status: text("status", { enum: CONNECTOR_EVENT_STATUSES }).notNull().default("queued"),
    // What the job made of it, a code only: the planner API's result or refusal ("created",
    // "session_has_bookings"), or why nothing was applied ("gone", "skipped_name", "source_off").
    outcomeCode: text("outcome_code"),
    processedAt: timestamptz("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("connector_events_firm_id_id_key").on(t.firmId, t.id),
    unique("connector_events_event_key").on(t.firmId, t.sourceId, t.eventId),
    foreignKey({
      name: "connector_events_source_fk",
      columns: [t.firmId, t.sourceId],
      foreignColumns: [rosterSources.firmId, rosterSources.id],
    }),
    index("connector_events_source_created_idx").on(t.firmId, t.sourceId, t.createdAt),
    // The reconcile pull's look for an event about the record it's applying (P5.4: pull.ts).
    index("connector_events_source_ref_idx").on(t.firmId, t.sourceId, t.ref),
    check(
      "connector_events_event_id_format",
      sql`${t.eventId} ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,98}[A-Za-z0-9])?$'`,
    ),
    check(
      "connector_events_ref_format",
      sql`${t.ref} ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,198}[A-Za-z0-9])?$'`,
    ),
    check(
      "connector_events_status_check",
      sql`${t.status} in (${sql.raw(CONNECTOR_EVENT_STATUSES.map((s) => `'${s}'`).join(", "))})`,
    ),
    check("connector_events_type_check", sql`${t.type} in ('session.changed', 'staff.changed')`),
    check("connector_events_outcome_format", sql`${t.outcomeCode} ~ '^[a-z0-9_]{1,50}$'`),
    // Queued: nothing made of it yet; anything else, when and what.
    check(
      "connector_events_outcome_when",
      sql`(${t.status} = 'queued') = (${t.processedAt} is null and ${t.outcomeCode} is null)`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
