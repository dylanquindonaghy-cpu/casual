import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";

// The inbound-message job's queue and payload (the handler is src/lib/inbound/reply.ts). Kept
// apart from the handler so the webhook, which only stores and queues, imports nothing that
// reaches AI code (tests/unit/ai.boundary.test.ts).

export const INBOUND_MESSAGE_QUEUE = "inbound-message";

export const inboundMessagePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^inbound-message:[0-9a-f-]{36}$/),
  messageId: z.uuid(),
});
export type InboundMessagePayload = z.infer<typeof inboundMessagePayload>;

export const inboundMessageJob = { queue: INBOUND_MESSAGE_QUEUE, schema: inboundMessagePayload };

export async function queueInboundMessage(tx: FirmTx, messageId: string): Promise<void> {
  await sendFirmJob(tx, inboundMessageJob, {
    idempotencyKey: `inbound-message:${messageId}`,
    messageId,
  });
}
