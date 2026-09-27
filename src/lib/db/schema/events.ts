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
    createdAt: createdAt(),
  },
  (t) => [
    index("events_firm_id_created_at_idx").on(t.firmId, t.createdAt),
    check("events_actor_type_check", sql`${t.actorType} in ('worker', 'office', 'system', 'ai')`),
    check("events_action_format", sql`${t.action} ~ '^[a-z_]+([.][a-z_]+)+$'`),
    ...firmIsolationAppendOnly(t.firmId),
  ],
).enableRLS();
