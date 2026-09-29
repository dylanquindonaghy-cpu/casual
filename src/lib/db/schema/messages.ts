import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, firmIsolation, timestamptz } from "./helpers";
import { workers } from "./people";
import { firms } from "./tenancy";

// Messages on the shifts line (Phase 7, docs/data-model.md `messages`): each WhatsApp a firm's
// number receives, and each reply the app sends to one. provider_message_id (Twilio's MessageSid,
// or the transport's id for a reply) is unique in the firm, so a webhook Twilio sends twice stores one row
// (golden rule 3). The worker is set when the sender's number is a worker of this firm. The text is
// the worker's own words: kept here (and in the reply's text), never copied into events. How it was
// handled and what they asked are set by the inbound-message job (src/lib/inbound/reply.ts), which
// claims a message (handled_at) before replying, so a reply goes at most once.

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
// voice: a call (body null) or a voicemail's text (Phase 7, call-to-text).
export const MESSAGE_CHANNELS = ["whatsapp", "sms", "voice"] as const;
// keyword: a word matched; ai: the AI picked; office: sent to the office (asked for, or unclear);
// unknown: the sender isn't a worker here; opt_out: a text saying STOP or START (Phase 7).
export const MESSAGE_HANDLING = ["keyword", "ai", "office", "unknown", "opt_out"] as const;
// Twilio's OptOutType on an incoming text, when its own opt-out handling acted on it (and sent its
// own confirmation).
export const TWILIO_OPT_OUTS = ["stop", "start"] as const;
export const MESSAGE_INTENTS = ["shifts", "cancel", "pay", "office"] as const;

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firms.id),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    channel: text("channel", { enum: MESSAGE_CHANNELS }).notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    workerId: uuid("worker_id"),
    fromE164: text("from_e164"), // null: a call or voicemail from a withheld number
    toE164: text("to_e164").notNull(),
    body: text("body"), // null when a message had no text (a photo only, say)
    handledAs: text("handled_as", { enum: MESSAGE_HANDLING }),
    intent: text("intent", { enum: MESSAGE_INTENTS }),
    handledAt: timestamptz("handled_at"), // an inbound message claimed by the job
    replyTo: uuid("reply_to"), // an outbound reply: the message it answers
    twilioOptOut: text("twilio_opt_out", { enum: TWILIO_OPT_OUTS }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("messages_firm_id_id_key").on(t.firmId, t.id),
    // Unique within the firm (a key starting with firm_id can't tell one firm about another's
    // rows): the same Twilio message always reaches the same firm, by the number it was sent to.
    unique("messages_firm_id_provider_message_id_key").on(t.firmId, t.providerMessageId),
    foreignKey({
      name: "messages_worker_fk",
      columns: [t.firmId, t.workerId],
      foreignColumns: [workers.firmId, workers.id],
    }),
    foreignKey({
      name: "messages_reply_to_fk",
      columns: [t.firmId, t.replyTo],
      foreignColumns: [t.firmId, t.id] as [AnyPgColumn, AnyPgColumn],
    }),
    index("messages_firm_id_created_at_idx").on(t.firmId, t.createdAt),
    index("messages_firm_id_worker_id_idx").on(t.firmId, t.workerId),
    check("messages_direction_check", sql`${t.direction} in ('in', 'out')`),
    check("messages_channel_check", sql`${t.channel} in ('whatsapp', 'sms', 'voice')`),
    check(
      "messages_handled_as_check",
      sql`${t.handledAs} in ('keyword', 'ai', 'office', 'unknown', 'opt_out')`,
    ),
    check("messages_intent_check", sql`${t.intent} in ('shifts', 'cancel', 'pay', 'office')`),
    check(
      "messages_from_e164",
      // "is not null" spelled out: a check that comes out null (null ~ …) would let the row in.
      sql`(${t.fromE164} is not null and ${t.fromE164} ~ '^[+][1-9][0-9]{6,14}$')
        or (${t.fromE164} is null and ${t.channel} = 'voice' and ${t.direction} = 'in')`,
    ),
    check("messages_to_e164", sql`${t.toE164} ~ '^[+][1-9][0-9]{6,14}$'`),
    check(
      "messages_twilio_opt_out",
      sql`${t.twilioOptOut} is null
        or (${t.twilioOptOut} in ('stop', 'start') and ${t.channel} = 'sms' and ${t.direction} = 'in')`,
    ),
    check("messages_body_length", sql`${t.body} is null or char_length(${t.body}) <= 1600`),
    // Only a reply answers a message; only an inbound message is handled.
    check(
      "messages_direction_fields",
      sql`(${t.direction} = 'in' and ${t.replyTo} is null)
        or (${t.direction} = 'out' and ${t.handledAs} is null and ${t.handledAt} is null)`,
    ),
    firmIsolation(t.firmId),
  ],
).enableRLS();
