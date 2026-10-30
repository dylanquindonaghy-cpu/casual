import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";

// The inbound-email job's queue and payload (the handler is src/lib/email/sort.ts). Kept apart from
// the handler so the webhook, which only stores and queues, imports nothing that reaches AI code
// (tests/unit/ai.boundary.test.ts), as the shifts line's (src/lib/inbound/job.ts).

export const INBOUND_EMAIL_QUEUE = "inbound-email";

// Sorting that fails is tried again this many times, 2 seconds apart (src/worker/jobs/queues.ts),
// as the shifts line's; the last try passes the email to a person and still fails the job.
export const INBOUND_EMAIL_RETRY_LIMIT = 3;

// The hourly sweep (src/lib/email/sort.ts runInboundEmailTick): emails whose job was lost queued
// again. Its queue's name lives here so the queue list imports nothing that reaches AI code.
export const INBOUND_EMAIL_TICK_QUEUE = "inbound-email-tick";
export const INBOUND_EMAIL_TICK_CRON = "17 * * * *";

export const inboundEmailPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^inbound-email:[0-9a-f-]{36}$/),
  emailId: z.uuid(),
});
export type InboundEmailPayload = z.infer<typeof inboundEmailPayload>;

export const inboundEmailJob = { queue: INBOUND_EMAIL_QUEUE, schema: inboundEmailPayload };

// Each job's group is its sender: the casual's worker id, or (an address that isn't a casual's) the
// email itself. Ids only, never the address. The worker runs one job per group at a time, so one
// casual's emails don't race each other.
export async function queueInboundEmail(
  tx: FirmTx,
  email: { id: string; workerId: string | null },
): Promise<void> {
  await sendFirmJob(
    tx,
    inboundEmailJob,
    { idempotencyKey: `inbound-email:${email.id}`, emailId: email.id },
    { group: { id: email.workerId ? `w:${email.workerId}` : `e:${email.id}` } },
  );
}
