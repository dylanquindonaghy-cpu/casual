import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { MESSAGE_HANDLING, MESSAGE_INTENTS } from "./messages";
import { workers } from "./people";
import { EMAIL_ADDRESS, firms } from "./tenancy";

// Emails to a firm's staffing inbox (P7.1; PLAN.md P7): its mailbox forwards to its address at our
// email provider (firms.inbox_address), whose webhook stores one row per Message-ID in the firm
// (golden rule 3: the same email twice is one row). Their own table, not the shifts line's
// `messages`, until the office's Enquiries learns email (the UI chat's). The casual it's from is
// set when the sender's address is a worker's here; only then are its subject and text kept, with
// quoted history and signatures taken off (src/lib/email/prepare.ts): anyone else's words are
// never stored, only who wrote. Attachments are never kept (sick notes are health data): only how
// many there were. How it was handled and what was asked are set by its job (P7.4), once.
// Owner-run purges and erasure delete rows (app_purge_old_messages, app_erase_worker): the app
// never does.

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    providerMessageId: text("provider_message_id").notNull(), // the email's Message-ID
    workerId: uuid("worker_id"),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(), // the firm's inbox
    subject: text("subject"), // a known casual's only
    body: text("body"), // a known casual's only: their words, quoted history taken off
    attachments: integer("attachments").notNull().default(0), // how many were left out
    handledAs: text("handled_as", { enum: MESSAGE_HANDLING }),
    intent: text("intent", { enum: MESSAGE_INTENTS }),
    handledAt: timestamptz("handled_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("inbound_emails_firm_id_id_key").on(t.firmId, t.id),
    unique("inbound_emails_firm_id_provider_message_id_key").on(t.firmId, t.providerMessageId),
    foreignKey({
      name: "inbound_emails_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    index("inbound_emails_firm_id_created_at_idx").on(t.firmId, t.createdAt),
    index("inbound_emails_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    // A worker's export and erasure find the ones from their address before it was known.
    index("inbound_emails_firm_id_from_address_idx").on(t.firmId, t.fromAddress),
    check("inbound_emails_message_id_format", sql`${t.providerMessageId} ~ '^[!-~]{1,250}$'`),
    check(
      "inbound_emails_from_format",
      sql`${t.fromAddress} ~ ${sql.raw(`'${EMAIL_ADDRESS}'`)} and char_length(${t.fromAddress}) <= 254`,
    ),
    check(
      "inbound_emails_to_format",
      sql`${t.toAddress} ~ ${sql.raw(`'${EMAIL_ADDRESS}'`)} and char_length(${t.toAddress}) <= 254`,
    ),
    // Words only from a known casual.
    check(
      "inbound_emails_words_known_only",
      sql`${t.workerId} is not null or (${t.subject} is null and ${t.body} is null)`,
    ),
    check("inbound_emails_subject_length", sql`char_length(${t.subject}) <= 300`),
    check("inbound_emails_body_length", sql`char_length(${t.body}) <= 4000`),
    check("inbound_emails_attachments_range", sql`${t.attachments} between 0 and 1000`),
    check(
      "inbound_emails_handled_as_check",
      sql`${t.handledAs} in (${sql.raw(MESSAGE_HANDLING.map((h) => `'${h}'`).join(", "))})`,
    ),
    check(
      "inbound_emails_intent_check",
      sql`${t.intent} in (${sql.raw(MESSAGE_INTENTS.map((i) => `'${i}'`).join(", "))})`,
    ),
    // Handled: when, and how.
    check("inbound_emails_handled_when", sql`(${t.handledAt} is null) = (${t.handledAs} is null)`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
