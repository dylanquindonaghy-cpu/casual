import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { messages, requests } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import { strangerTextsOff } from "../inbound/opt-out";
import { sendToWorker, smsAllowedFor } from "../notify/send";

// Sending the office's reply on Enquiries (docs/office-v2.md 3.6; docs/api-and-jobs.md
// `enquiry-reply`; 12D.1). The office's action (src/lib/office/enquiry-actions.ts) has already
// stored the outgoing message (its `messages` row, with `reply_to` and a placeholder provider id)
// and logged `enquiry.answered`; only the worker has the messaging transport, so this job sends it.
// The payload is the reply's id only.
//
// At most once, like the other notices: (1) a short transaction claims it (`enquiry.reply_sending`,
// under an advisory lock on the reply) and commits; (2) the message goes outside any transaction,
// from the firm's shifts line stored on the row, by the shared sender (`sendToWorker()`: the
// WhatsApp-to-text fallback, never a text after STOP: a casual's own setting, or for a number that
// isn't a casual's, its own last STOP or START to the line); (3) a second short transaction
// records `enquiry.reply_sent` (the row gets the provider's id and the channel it went by) or
// `enquiry.reply_failed`, which reopens the question this reply answered, so the message is back
// in Need a person. A job that stops part-way leaves the claim: the message may have gone, so it's
// never sent again.
//
// No quiet hours: it answers the casual's own message, and a person chose to send it now. Every
// enquiry entry is on the casual's message (entity), with ids, the channel and codes only, never
// the words.

export const ENQUIRY_REPLY_QUEUE = "enquiry-reply";
export const OFFICE_REPLY_PREFIX = "office-reply:"; // the stored row's provider id until it's sent

export const enquiryReplyPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^enquiry-reply:[0-9a-f-]{36}$/),
  replyId: z.uuid(),
});
export type EnquiryReplyPayload = z.infer<typeof enquiryReplyPayload>;

const job = { queue: ENQUIRY_REPLY_QUEUE, schema: enquiryReplyPayload };

export async function queueEnquiryReply(tx: FirmTx, replyId: string): Promise<void> {
  await sendFirmJob(tx, job, { idempotencyKey: `enquiry-reply:${replyId}`, replyId });
}

export interface EnquiryReplyDeps {
  transport: MessagingTransport;
}

export type EnquiryReplyResult =
  | { status: "sent"; channel: "whatsapp" | "sms" }
  | { status: "failed"; code: string }
  | { status: "already" }
  | { status: "gone" };

type Claim =
  | {
      status: "send";
      messageId: string; // the casual's message it answers
      requestId: string | null; // the question this reply answered (reopened if it fails)
      workerId: string | null;
      smsAllowed: boolean;
      channel: "whatsapp" | "sms";
      to: string;
      from: string;
      body: string;
    }
  | { status: "already" }
  | { status: "gone" };

async function claim(tx: FirmTx, p: EnquiryReplyPayload): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('enquiry-reply:' || app_current_firm_id()::text || ':' || ${p.replyId}, 0))`,
  );
  const { rows } = await tx.execute<{
    reply_to: string | null;
    channel: "whatsapp" | "sms" | "voice";
    body: string | null;
    to_e164: string;
    from_e164: string | null;
    provider_message_id: string;
    worker_id: string | null;
    sms_opted_out_at: string | Date | null;
  }>(sql`
    select o.reply_to, o.channel, o.body, o.to_e164, o.from_e164, o.provider_message_id,
           o.worker_id, w.sms_opted_out_at
      from messages o
      left join workers w on w.firm_id = o.firm_id and w.id = o.worker_id
     where o.id = ${p.replyId} and o.direction = 'out'
  `);
  const o = rows[0];
  // Gone: deleted (an erasure, the 90-day purge).
  if (!o || !o.reply_to) return { status: "gone" };
  // Claimed before (sent, failed, or stopped part-way): never again.
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${o.reply_to} and action = 'enquiry.reply_sending'
       and data ->> 'replyId' = ${p.replyId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  // Not an office reply waiting to go.
  if (
    !o.body ||
    !o.from_e164 ||
    o.channel === "voice" ||
    !o.provider_message_id.startsWith(OFFICE_REPLY_PREFIX)
  ) {
    return { status: "gone" };
  }
  // The question this reply answered, from the office's own log entry.
  const { rows: answered } = await tx.execute<{ request_id: string | null }>(sql`
    select data ->> 'requestId' as request_id from events
     where entity_id = ${o.reply_to} and action = 'enquiry.answered'
       and data ->> 'replyId' = ${p.replyId}
     limit 1
  `);
  await recordEvent(tx, {
    actorType: "system",
    action: "enquiry.reply_sending",
    entityType: "message",
    entityId: o.reply_to,
    data: { replyId: p.replyId, ...(o.worker_id ? { workerId: o.worker_id } : {}) },
  });
  return {
    status: "send",
    messageId: o.reply_to,
    requestId: answered[0]?.request_id ?? null,
    workerId: o.worker_id,
    smsAllowed: o.worker_id
      ? smsAllowedFor({ smsOptedOutAt: o.sms_opted_out_at })
      : !(await strangerTextsOff(tx, o.to_e164)),
    channel: o.channel,
    to: o.to_e164,
    from: o.from_e164,
    body: o.body,
  };
}

export async function runEnquiryReply(
  payload: EnquiryReplyPayload,
  run: WithFirm,
  deps: EnquiryReplyDeps,
): Promise<EnquiryReplyResult> {
  const c = await run(payload.firmId, (tx) => claim(tx, payload));
  if (c.status !== "send") return c;

  const sent = await sendToWorker(deps, {
    mobile: c.to,
    channel: c.channel,
    smsAllowed: c.smsAllowed,
    body: { whatsapp: c.body, sms: c.body },
    from: c.from,
  });

  return run(payload.firmId, async (tx): Promise<EnquiryReplyResult> => {
    const who = c.workerId ? { workerId: c.workerId } : {};
    if (!sent.ok) {
      // The question it answered is open again: the message is back in Need a person.
      if (c.requestId) {
        await tx
          .update(requests)
          .set({ status: "open", resolvedBy: null, resolvedAt: null, resolutionNote: null })
          .where(and(eq(requests.id, c.requestId), eq(requests.status, "approved")));
      }
      await recordEvent(tx, {
        actorType: "system",
        action: "enquiry.reply_failed",
        entityType: "message",
        entityId: c.messageId,
        data: {
          replyId: payload.replyId,
          channel: sent.channel,
          code: sent.code,
          ...(c.requestId ? { requestId: c.requestId } : {}),
          ...who,
        },
      });
      return { status: "failed", code: sent.code };
    }
    await tx
      .update(messages)
      .set({ providerMessageId: sent.providerMessageId, channel: sent.channel })
      .where(eq(messages.id, payload.replyId));
    await recordEvent(tx, {
      actorType: "system",
      action: "enquiry.reply_sent",
      entityType: "message",
      entityId: c.messageId,
      data: {
        replyId: payload.replyId,
        channel: sent.channel,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
        ...who,
      },
    });
    return { status: "sent", channel: sent.channel };
  });
}

export function createEnquiryReplyTask(
  deps: () => EnquiryReplyDeps,
): FirmTask<EnquiryReplyPayload> {
  return {
    queue: ENQUIRY_REPLY_QUEUE,
    schema: enquiryReplyPayload,
    task: (payload, run) => runEnquiryReply(payload, run, deps()),
  };
}

export const enquiryReplyTask = createEnquiryReplyTask(() => ({
  transport: getTransport(workerEnv()),
}));
