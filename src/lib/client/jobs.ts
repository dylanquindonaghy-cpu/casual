import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";

// Client requests' jobs (Phase 36.4): their queues and payloads, here apart so a request or an
// answer queues its job without loading the senders (src/lib/client/notify.ts). Ids only.
//
// - client-request-alert {requestId}: an urgent request, pushed to the admins and resourcers on its
//   contract who left "Tell me about: client requests" on (queued by the request itself, by a reply
//   that puts an urgent one back with the office, and by the office alerts' tick for one that has
//   become urgent since; each person is told once, by the alert's claim).
// - client-request-answer {requestId, answerEventId}: the client told of the office's answer
//   (accepted, declined or a question) by email; one per answer, keyed by its log entry.

export const CLIENT_REQUEST_ALERT_QUEUE = "client-request-alert";
export const CLIENT_REQUEST_ANSWER_QUEUE = "client-request-answer";

export const clientRequestAlertPayload = firmJobEnvelope.extend({ requestId: z.uuid() });
export type ClientRequestAlertPayload = z.infer<typeof clientRequestAlertPayload>;
export const clientRequestAnswerPayload = firmJobEnvelope.extend({
  requestId: z.uuid(),
  answerEventId: z.int().positive(),
});
export type ClientRequestAnswerPayload = z.infer<typeof clientRequestAnswerPayload>;

// `key`: what queued it beyond the request itself (a reply's log entry, the tick's slot), so a
// later reason queues a job of its own; ids and separators only.
export async function queueClientRequestAlert(
  tx: FirmTx,
  input: { requestId: string; key?: string },
): Promise<void> {
  const key = `client-request-alert:${input.requestId}${input.key ? `:${input.key}` : ""}`;
  await sendFirmJob(
    tx,
    { queue: CLIENT_REQUEST_ALERT_QUEUE, schema: clientRequestAlertPayload },
    { idempotencyKey: key, requestId: input.requestId },
    { singletonKey: key },
  );
}

export async function queueClientRequestAnswer(
  tx: FirmTx,
  input: { requestId: string; answerEventId: number },
): Promise<void> {
  await sendFirmJob(
    tx,
    { queue: CLIENT_REQUEST_ANSWER_QUEUE, schema: clientRequestAnswerPayload },
    {
      idempotencyKey: `client-request-answer:${input.answerEventId}`,
      requestId: input.requestId,
      answerEventId: input.answerEventId,
    },
  );
}
