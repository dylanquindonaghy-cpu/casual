import { sql } from "drizzle-orm";
import {
  boolean,
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
import { officeUsers, workers } from "./people";
import { EMAIL_ADDRESS, firms } from "./tenancy";

// Emails to a firm's staffing inbox (P7.1; PLAN.md P7): its mailbox forwards to its address at our
// email provider (firms.inbox_address), whose webhook stores one row per Message-ID in the firm
// (golden rule 3: the same email twice is one row). Their own table, not the shifts line's
// `messages`, until the office's Enquiries learns email (the UI chat's). The casual it's from is
// set when the sender's address is a worker's here; only then are its subject and text kept, with
// quoted history and signatures taken off (src/lib/email/prepare.ts): anyone else's words are
// never stored, only who wrote. Attachments are never kept (sick notes are health data): only how
// many there were. How it was handled and what was asked are set by its job (P7.4), once, with
// the AI's draft of a reply for the office to check (P7.5; never for pay: golden rule 9).
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
    // The AI's draft of the office's reply (P7.5), from a known casual's words only; the office
    // checks and changes it before anything goes. Null: none (AI off, pay, or it gave none).
    draftReply: text("draft_reply"),
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
    // A draft only for a known casual's email, once handled, and never for pay (golden rule 9).
    check(
      "inbound_emails_draft_reply_known",
      sql`${t.draftReply} is null or (${t.workerId} is not null and ${t.handledAt} is not null
          and ${t.intent} is distinct from 'pay')`,
    ),
    check(
      "inbound_emails_draft_reply_length",
      sql`char_length(${t.draftReply}) between 1 and 1200`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();

export const EMAIL_REPLY_KINDS = ["automatic", "office"] as const;
export const EMAIL_REPLY_TEMPLATES = ["shifts", "cancel", "pay"] as const;

// What went back to a casual about their email to the staffing inbox (P7.5): the automatic link
// email (src/lib/email/sort.ts) or the office's reply (src/lib/office/enquiry-actions.ts), as it
// was sent, to the address the firm held for them then (never the one the email came from). Added
// once, never changed: whether it went is in the action log (`email.replied` /
// `email.reply_failed`; `enquiry.reply_sending` / `enquiry.reply_sent` / `enquiry.reply_failed`).
// Deleted with its email (the purge, an erasure), never by the app.
export const emailReplies = pgTable(
  "email_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    inboundEmailId: uuid("inbound_email_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    kind: text("kind", { enum: EMAIL_REPLY_KINDS }).notNull(),
    // An automatic reply's: which link it gave.
    template: text("template", { enum: EMAIL_REPLY_TEMPLATES }),
    // The office's: who sent it, and whether it began as the AI's draft.
    sentBy: uuid("sent_by"),
    fromDraft: boolean("from_draft").notNull().default(false),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("email_replies_firm_id_id_key").on(t.firmId, t.id),
    foreignKey({
      name: "email_replies_email_fk",
      columns: [t.firmId, t.inboundEmailId],
      foreignColumns: [inboundEmails.firmId, inboundEmails.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "email_replies_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "email_replies_sent_by_fk",
      columns: [t.firmId, t.sentBy],
      foreignColumns: [officeUsers.firmId, officeUsers.id],
    }),
    index("email_replies_firm_id_inbound_email_id_idx").on(t.firmId, t.inboundEmailId),
    index("email_replies_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    check(
      "email_replies_kind_check",
      sql`${t.kind} in (${sql.raw(EMAIL_REPLY_KINDS.map((k) => `'${k}'`).join(", "))})`,
    ),
    check(
      "email_replies_template_check",
      sql`${t.template} in (${sql.raw(EMAIL_REPLY_TEMPLATES.map((k) => `'${k}'`).join(", "))})`,
    ),
    // An automatic reply names its link and no sender; the office's names who sent it.
    check(
      "email_replies_kind_fields",
      sql`case when ${t.kind} = 'automatic'
            then ${t.template} is not null and ${t.sentBy} is null and not ${t.fromDraft}
            else ${t.template} is null and ${t.sentBy} is not null
          end`,
    ),
    check(
      "email_replies_to_format",
      sql`${t.toAddress} ~ ${sql.raw(`'${EMAIL_ADDRESS}'`)} and char_length(${t.toAddress}) <= 254`,
    ),
    check("email_replies_subject_length", sql`char_length(${t.subject}) between 1 and 200`),
    check("email_replies_body_length", sql`char_length(${t.body}) between 1 and 4000`),
    firmIsolation(t.firmId),
  ],
).enableRLS();
