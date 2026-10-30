import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, firmIsolationAppendOnly } from "./helpers";
import { firms } from "./tenancy";

export const ACTOR_TYPES = ["worker", "office", "system", "ai"] as const;

// The action log (golden rule 5). Append-only: the app role gets SELECT and INSERT only, and
// there are no update or delete policies. data never holds tokens, codes, phones, emails or IPs.
export const events = pgTable(
  "events",
  {
    // An identity column needs no sequence grant for the app role (bigserial would).
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    actorType: text("actor_type", { enum: ACTOR_TYPES }).notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // The worker and the session the entry names in its data, copied by the database when it's
    // written (Phase 25.3; Dylan, 2026-10-30): the action log finds an entry by them through an
    // index. An index on `data ->> 'workerId'` itself can't be used under RLS (jsonb's functions
    // aren't leakproof, so Postgres checks the firm first and every row after); a plain text
    // column compares with texteq, which is. Nothing new is stored, and the log stays append-only.
    workerRef: text("worker_ref").generatedAlwaysAs(sql`(data ->> 'workerId')`),
    shiftRef: text("shift_ref").generatedAlwaysAs(sql`(data ->> 'shiftId')`),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_firm_id_created_at_idx").on(t.firmId, t.createdAt),
    // One thing's history: a shift's waves and escalation on the dashboard, the action log by shift
    // or worker (Phase 5).
    index("events_firm_id_entity_id_idx").on(t.firmId, t.entityId, t.id),
    // Entries of a kind over a time (the sends the ops alerts count, the webhook status, the
    // action log by kind; P4.1).
    index("events_firm_id_action_created_at_idx").on(t.firmId, t.action, t.createdAt),
    // The action log by worker or by shift (Phase 25.3, P4's "the jsonb OR chain"): the entries that
    // name them in their data, and those a worker did, each found by its own look-up
    // (src/lib/office/action-log.ts) instead of every entry in the dates being checked.
    index("events_firm_id_worker_ref_idx")
      .on(t.firmId, t.workerRef, t.id)
      .where(sql`${t.workerRef} is not null`),
    index("events_firm_id_shift_ref_idx")
      .on(t.firmId, t.shiftRef, t.id)
      .where(sql`${t.shiftRef} is not null`),
    index("events_firm_id_actor_id_idx")
      .on(t.firmId, t.actorId, t.id)
      .where(sql`${t.actorId} is not null`),
    check("events_actor_type_check", sql`${t.actorType} in ('worker', 'office', 'system', 'ai')`),
    check("events_action_format", sql`${t.action} ~ '^[a-z_]+([.][a-z_]+)+$'`),
    ...firmIsolationAppendOnly(t.firmId),
  ],
).enableRLS();
