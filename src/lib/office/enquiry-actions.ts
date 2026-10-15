import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { firms, messages, requests } from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeReplyMessage, requestUpdateMessage } from "../messaging/templates";
import { OFFICE_REPLY_PREFIX, queueEnquiryReply } from "../notices/enquiry-reply";
import { signOffFor } from "../tenancy/sign-off";
import { enquiryWindow, needsPerson, replyPlanFor } from "./enquiries";
import { CLOSE_REASONS, REPLY_MAX, replyLine, type CloseReason } from "./enquiry-rules";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// The office answering a message that needs a person (docs/office-v2.md 3.6; 12D.1): a reply in
// their words, or "Close without a reply" with a reason code. An active admin or resourcer of the
// firm. One transaction each, with the casual's message locked, so two people can't both answer
// it; only a message that still needs a person can be answered or closed. Server only.
//
// - Reply: the way it goes is worked out now (src/lib/office/enquiry-rules.ts `replyPlan`): free
//   text inside WhatsApp's 24-hour window or by text, otherwise the `request_update` template as a
//   question answered. The outgoing `messages` row is stored at once, with `reply_to` (an unknown
//   number's too: `worker_id` empty) and a placeholder provider id; its question, if open, is
//   answered (stored `approved`, the words as its note); `enquiry.answered` is logged; the
//   `enquiry-reply` job sends it (src/lib/notices/enquiry-reply.ts) and puts the question back if
//   it fails.
// - Close: a code from CLOSE_REASONS, logged `enquiry.closed`; an open question is closed with it
//   (answered for "dealt with by phone", sorted otherwise) and the casual isn't messaged.
// Typed text never goes in the log (append-only): the words stay on the message row and the
// question's note.

export type ReplyResult =
  | { status: "queued"; channel: "whatsapp" | "sms"; form: "free_text" | "template" }
  | { status: "empty" | "too_long" }
  | { status: "no_line" | "withheld" | "unknown_caller" | "texts_off" }
  | { status: "not_waiting" } // answered, closed or sorted already
  | { status: "not_found" | "not_allowed" };

export type CloseResult =
  { status: "closed" } | { status: "not_waiting" | "not_found" | "not_allowed" | "invalid" };

export const replySchema = z.strictObject({
  messageId: z.uuid(),
  text: z.string().max(20_000),
});
export const closeSchema = z.strictObject({
  messageId: z.uuid(),
  reason: z.enum(CLOSE_REASONS),
});

type Locked = {
  id: string;
  channel: "whatsapp" | "sms" | "voice";
  from_e164: string | null;
  to_e164: string;
  worker_id: string | null;
  notify_channel: "whatsapp" | "sms" | null;
  sms_opted_out_at: string | Date | null;
  waiting: boolean;
};

// The casual's message, locked, and whether it still needs a person (enquiries.ts's rule).
async function lockMessage(tx: FirmTx, messageId: string, now: Date): Promise<Locked | null> {
  const { since } = await enquiryWindow(tx, now);
  const [row] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.direction, "in")))
    .for("update");
  if (!row) return null;
  const { rows } = await tx.execute<Locked>(sql`
    select m.id, m.channel, m.from_e164, m.to_e164, m.worker_id, w.notify_channel,
           w.sms_opted_out_at,
           (m.created_at > ${since} and ${needsPerson("m")}) as waiting
      from messages m
      left join workers w on w.firm_id = m.firm_id and w.id = m.worker_id
     where m.id = ${messageId}
  `);
  return rows[0] ?? null;
}

// Its open question, locked (after the message: the same order every time).
async function openQuestion(tx: FirmTx, messageId: string) {
  const [q] = await tx
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.messageId, messageId), inArray(requests.status, ["open", "escalated"])))
    .for("update");
  return q ?? null;
}

export async function replyToEnquiry(
  ctx: OfficeContext,
  messageId: string,
  typed: string,
): Promise<ReplyResult> {
  if (typeof typed === "string" && typed.length > 20_000) return { status: "too_long" };
  const parsed = replySchema.safeParse({ messageId, text: typed });
  if (!parsed.success) return { status: "not_found" };
  const text = replyLine(parsed.data.text);
  if (text === "") return { status: "empty" };
  if (text.length > REPLY_MAX) return { status: "too_long" };
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  // Run again if Postgres aborts it to break a deadlock (an erasure locks the casual, then their
  // messages): it holds everything it does, the job included.
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<ReplyResult> => {
      if (!(await officeUserMay(tx, by.id, "enquiries"))) return { status: "not_allowed" };
      const m = await lockMessage(tx, messageId, now);
      if (!m) return { status: "not_found" };
      if (!m.waiting) return { status: "not_waiting" };
      const { plan, line } = await replyPlanFor(tx, m, now);
      if (!plan.ok) return { status: plan.why };
      if (!m.from_e164 || !line) return { status: "withheld" }; // replyPlan said ok: never here

      const [firm] = await tx
        .select({ name: firms.name, settings: firms.settings })
        .from(firms)
        .where(eq(firms.id, sql`app_current_firm_id()`));
      const voice = {
        name: firm?.name ?? "",
        signOff: signOffFor(firm?.name ?? "", firm?.settings.sign_off),
      };
      const question = await openQuestion(tx, m.id);
      const body =
        plan.form === "free_text"
          ? officeReplyMessage(voice, text, plan.channel)
          : requestUpdateMessage(voice, {
              type: "question",
              ref: (question?.id ?? m.id).slice(0, 8).toUpperCase(),
              status: "answered",
              note: text,
            });
      const [reply] = await tx
        .insert(messages)
        .values({
          firmId: sql`app_current_firm_id()`,
          direction: "out",
          channel: plan.channel,
          providerMessageId: `${OFFICE_REPLY_PREFIX}${randomUUID()}`,
          workerId: m.worker_id,
          // The firm's shifts line now, never the number an old message came in on (it may be
          // another firm's by then).
          fromE164: line,
          toE164: m.from_e164,
          body,
          replyTo: m.id,
          createdAt: now,
        })
        .returning({ id: messages.id });
      if (!reply) throw new Error("reply insert returned nothing");
      if (question) {
        await tx
          .update(requests)
          .set({ status: "approved", resolvedBy: by.id, resolvedAt: now, resolutionNote: text })
          .where(eq(requests.id, question.id));
      }
      await recordEvent(tx, {
        actorType: "office",
        actorId: by.id,
        action: "enquiry.answered",
        entityType: "message",
        entityId: m.id,
        data: {
          replyId: reply.id,
          channel: plan.channel,
          form: plan.form,
          ...(m.worker_id ? { workerId: m.worker_id } : {}),
          ...(question ? { requestId: question.id } : {}),
        },
      });
      await queueEnquiryReply(tx, reply.id);
      return { status: "queued", channel: plan.channel, form: plan.form };
    }),
  );
}

export async function closeEnquiry(
  ctx: OfficeContext,
  messageId: string,
  reason: CloseReason,
): Promise<CloseResult> {
  const parsed = closeSchema.safeParse({ messageId, reason });
  if (!parsed.success) return { status: "invalid" };
  const { run, by } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<CloseResult> => {
      if (!(await officeUserMay(tx, by.id, "enquiries"))) return { status: "not_allowed" };
      const m = await lockMessage(tx, parsed.data.messageId, now);
      if (!m) return { status: "not_found" };
      if (!m.waiting) return { status: "not_waiting" };
      const question = await openQuestion(tx, m.id);
      if (question) {
        await tx
          .update(requests)
          .set({
            // Dealt with by phone: answered. Anything else: sorted (the casual sees "Sorted", never a
            // bare "Declined" with no reason).
            status: parsed.data.reason === "by_phone" ? "approved" : "auto_resolved",
            resolvedBy: by.id,
            resolvedAt: now,
          })
          .where(eq(requests.id, question.id));
      }
      await recordEvent(tx, {
        actorType: "office",
        actorId: by.id,
        action: "enquiry.closed",
        entityType: "message",
        entityId: m.id,
        data: {
          reason: parsed.data.reason,
          ...(m.worker_id ? { workerId: m.worker_id } : {}),
          ...(question ? { requestId: question.id } : {}),
        },
      });
      return { status: "closed" };
    }),
  );
}
