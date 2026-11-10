import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ANSWER_BODY_MAX,
  ANSWER_EXAMPLE_MAX,
  ANSWER_EXAMPLES_MAX,
  ANSWER_NAME_MAX,
} from "../../answers/limits";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { officeUsers } from "./people";
import { firms } from "./tenancy";

// The answer library (Phase 35; docs/screens.md "## Phase 35"; docs/data-model.md `answers`): the
// firm's own automatic answers to common questions, which an admin writes and switches on. A
// casual's message (app, text or the staffing inbox) that matches one of a switched-on answer's
// example phrases (in code), or that the AI picks it for, gets the answer's words with the fill-ins
// done by code from the firm's data (src/lib/answers/). The AI never writes a word a casual sees.
// Never deleted, only switched off (TABLE_ACCESS: SELECT, INSERT and UPDATE of the editable columns
// only). The five starters (starter_key) are added switched off for every firm (migration 0073,
// firm creation, the demo seed), at most one of each per firm.

export { ANSWER_BODY_MAX, ANSWER_EXAMPLE_MAX, ANSWER_EXAMPLES_MAX, ANSWER_NAME_MAX };

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    name: text("name").notNull(),
    // Example phrases, one a line (at most 10 lines of at most 100 characters); may be empty.
    examples: text("examples").notNull().default(""),
    // The words, with fill-ins from the fixed list as {key} (src/lib/answers/fill-ins.ts).
    body: text("body").notNull(),
    isOn: boolean("is_on").notNull().default(false),
    // Which starter it came from (src/lib/answers/starters.ts); null: the firm's own.
    starterKey: text("starter_key"),
    // Who last changed it; null: added by the system (a starter) and not changed since.
    updatedBy: uuid("updated_by"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("answers_firm_id_id_key").on(t.firmId, t.id),
    uniqueIndex("answers_firm_id_starter_key_idx")
      .on(t.firmId, t.starterKey)
      .where(sql`starter_key is not null`),
    foreignKey({
      name: "answers_updated_by_fk",
      columns: [t.firmId, t.updatedBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    check(
      "answers_name_length",
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(ANSWER_NAME_MAX))}`,
    ),
    check(
      "answers_body_length",
      sql`char_length(${t.body}) between 1 and ${sql.raw(String(ANSWER_BODY_MAX))}`,
    ),
    // At most 10 lines, none longer than 100 characters.
    check(
      "answers_examples_shape",
      sql`char_length(${t.examples}) <= 1100
        and char_length(${t.examples}) - char_length(replace(${t.examples}, E'\\n', '')) <= ${sql.raw(String(ANSWER_EXAMPLES_MAX - 1))}
        and ${t.examples} !~ ${sql.raw(`'[^\\n]{${ANSWER_EXAMPLE_MAX + 1}}'`)}`,
    ),
    check("answers_starter_key_format", sql`${t.starterKey} ~ '^[a-z_]{1,40}$'`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
