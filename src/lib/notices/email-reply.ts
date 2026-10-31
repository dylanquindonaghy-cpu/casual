import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { errorCode, firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";

// Sending the office's reply to a casual's email to the staffing inbox (P7.5; docs/api-and-jobs.md
// `enquiry-email-reply`; Phase 25.5). The office's action (src/lib/office/enquiry-actions.ts) has
// already stored it as sent (its `email_replies` row: the address the firm held for the casual
// then, the subject and the words a person checked) and logged `enquiry.answered`; only the worker
// has the email sender, so this job sends it. The payload is the reply's id only.
//
// At most once, as the shifts line's office reply (src/lib/notices/enquiry-reply.ts): (1) a short
// transaction claims it (`enquiry.reply_sending`, under an advisory lock on the reply) and commits;
// (2) the email goes outside any transaction, with the firm's staffing inbox as its Reply-To, so
// their answer comes back to Enquiries; (3) a second short transaction records
// `enquiry.reply_sent` or `enquiry.reply_failed`, which puts the email back in Need a person. A job
// that stops part-way leaves the claim: the email may have gone, so it's never sent again. Every
// entry is on the casual's email (entity), with ids and codes only, never the words.

export const ENQUIRY_EMAIL_REPLY_QUEUE = "enquiry-email-reply";

export const enquiryEmailReplyPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^enquiry-email-reply:[0-9a-f-]{36}$/),
  replyId: z.uuid(),
});
export type EnquiryEmailReplyPayload = z.infer<typeof enquiryEmailReplyPayload>;

const job = { queue: ENQUIRY_EMAIL_REPLY_QUEUE, schema: enquiryEmailReplyPayload };

export async function queueEnquiryEmailReply(tx: FirmTx, replyId: string): Promise<void> {
  await sendFirmJob(tx, job, { idempotencyKey: `enquiry-email-reply:${replyId}`, replyId });
}

export interface EnquiryEmailReplyDeps {
  transport: MessagingTransport;
}

export type EnquiryEmailReplyResult =
  | { status: "sent" }
  | { status: "failed"; code: string }
  | { status: "already" }
  | { status: "gone" };

type Claim =
  | {
      status: "send";
      emailId: string;
      workerId: string;
      to: string;
      replyTo: string | null;
      subject: string;
      body: string;
    }
  | { status: "already" }
  | { status: "gone" };

async function claim(tx: FirmTx, p: EnquiryEmailReplyPayload): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('enquiry-email-reply:' || app_current_firm_id()::text || ':' || ${p.replyId}, 0))`,
  );
  const { rows } = await tx.execute<{
    inbound_email_id: string;
    worker_id: string;
    kind: string;
    to_address: string;
    subject: string;
    body: string;
    inbox_address: string | null;
  }>(sql`
    select r.inbound_email_id, r.worker_id, r.kind, r.to_address, r.subject, r.body,
           f.inbox_address
      from email_replies r
      join firms f on f.id = r.firm_id
     where r.id = ${p.replyId}
  `);
  const r = rows[0];
  // Gone: deleted with its email (an erasure, the purge); or not the office's.
  if (!r || r.kind !== "office") return { status: "gone" };
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${r.inbound_email_id} and action = 'enquiry.reply_sending'
       and data ->> 'replyId' = ${p.replyId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  await recordEvent(tx, {
    actorType: "system",
    action: "enquiry.reply_sending",
    entityType: "inbound_email",
    entityId: r.inbound_email_id,
    data: { replyId: p.replyId, channel: "email", workerId: r.worker_id },
  });
  return {
    status: "send",
    emailId: r.inbound_email_id,
    workerId: r.worker_id,
    to: r.to_address,
    replyTo: r.inbox_address,
    subject: r.subject,
    body: r.body,
  };
}

// A send failure's code, as the log and the office see it (never the server's words or an address).
const safeCode = (code: string) =>
  /^[0-9A-Z]{5}$/.test(code) || /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(code) ? code : "unknown";

export async function runEnquiryEmailReply(
  payload: EnquiryEmailReplyPayload,
  run: WithFirm,
  deps: EnquiryEmailReplyDeps,
): Promise<EnquiryEmailReplyResult> {
  const c = await run(payload.firmId, (tx) => claim(tx, payload));
  if (c.status !== "send") return c;
  try {
    await deps.transport.send({
      channel: "email",
      to: c.to,
      ...(c.replyTo ? { replyTo: c.replyTo } : {}),
      subject: c.subject,
      body: c.body,
    });
  } catch (err) {
    const code = safeCode(errorCode(err));
    await run(payload.firmId, (tx) =>
      recordEvent(tx, {
        actorType: "system",
        action: "enquiry.reply_failed",
        entityType: "inbound_email",
        entityId: c.emailId,
        data: { replyId: payload.replyId, channel: "email", code, workerId: c.workerId },
      }),
    );
    return { status: "failed", code };
  }
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: "enquiry.reply_sent",
      entityType: "inbound_email",
      entityId: c.emailId,
      data: { replyId: payload.replyId, channel: "email", workerId: c.workerId },
    }),
  );
  return { status: "sent" };
}

export function enquiryEmailReplyTask(
  deps: () => EnquiryEmailReplyDeps,
): FirmTask<EnquiryEmailReplyPayload> {
  return { ...job, task: (payload, run) => runEnquiryEmailReply(payload, run, deps()) };
}

export const enquiryEmailReplyFirmTask = enquiryEmailReplyTask(() => ({
  transport: getTransport(workerEnv()),
}));
