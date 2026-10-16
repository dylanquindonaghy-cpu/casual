import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";

// The inbound-message job's queue and payload (the handler is src/lib/inbound/reply.ts). Kept
// apart from the handler so the webhook, which only stores and queues, imports nothing that
// reaches AI code (tests/unit/ai.boundary.test.ts).

export const INBOUND_MESSAGE_QUEUE = "inbound-message";

// A reply that fails is tried again this many times (src/worker/jobs/queues.ts), the last within
// about half a minute. The last try passes the message to a person (src/lib/inbound/reply.ts).
export const INBOUND_RETRY_LIMIT = 3;

export const inboundMessagePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^inbound-message:[0-9a-f-]{36}$/),
  messageId: z.uuid(),
});
export type InboundMessagePayload = z.infer<typeof inboundMessagePayload>;

export const inboundMessageJob = { queue: INBOUND_MESSAGE_QUEUE, schema: inboundMessagePayload };

// Each job's group is its sender: their worker id, or (a number that isn't a worker's) the message
// itself. Ids only, never the number. The worker runs one job per group at a time
// (src/worker/jobs/index.ts), so one person's messages don't race each other; the handler also
// answers a sender's older messages first (src/lib/inbound/reply.ts), so order holds regardless.
export async function inboundJobOptions(
  tx: FirmTx,
  messageId: string,
): Promise<{ group: { id: string } }> {
  const { rows } = await tx.execute<{ worker_id: string | null }>(sql`
    select w.id::text as worker_id
      from messages m
      left join workers w on w.firm_id = m.firm_id and w.mobile_e164 = m.from_e164
     where m.id = ${messageId}
     limit 1
  `);
  const workerId = rows[0]?.worker_id;
  return { group: { id: workerId ? `w:${workerId}` : `m:${messageId}` } };
}

export async function queueInboundMessage(tx: FirmTx, messageId: string): Promise<void> {
  await sendFirmJob(
    tx,
    inboundMessageJob,
    { idempotencyKey: `inbound-message:${messageId}`, messageId },
    await inboundJobOptions(tx, messageId),
  );
}
