import { eq } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { firms } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import type { FirmTask, JobAttempt } from "../jobs/firm-job";
import { log, type Logger } from "../log";
import {
  WEBHOOK_DELIVER_QUEUE,
  webhookDeliverPayload,
  webhookOf,
  type WebhookDeliverPayload,
  type WebhookType,
} from "./outbox";
import { addressHost, WebhookSendError, type WebhookFailureCode } from "./send";
import { signingKey, testEventId, webhookEventId } from "./secrets";
import { signedHeaders } from "./sign";
import { webhookTransport, type WebhookTransport } from "./webhook-transport";
import { buildWebhook } from "./webhooks";

// The `webhook-deliver` job (docs/office-v2.md 5.3.3; 12J.2), a firm task on its own queue
// (src/worker/jobs/queues.ts: retryLimit 6, retryDelay 60, retryBackoff, retryDelayMax 1800, about
// an hour in all).
// 1. A short transaction reads the firm's webhook address and signing version (none any more: the
//    address was removed while this waited, and nothing is sent or logged) and builds the body
//    from the rows (webhooks.ts).
// 2. One signed POST (Standard Webhooks) through the transport, with no transaction open.
// 3. A 2xx: `webhook.delivered {eventRef, bookingId, type}`. Anything else throws, and pg-boss tries
//    again, until the last try: it logs `webhook.failed {eventRef, bookingId, type, code}` (which
//    raises the Needs attention item) and then completes the job rather than failing it, so a
//    firm's own endpoint problem isn't an ops alert to Dylan (failedJobCounts()). The planner
//    catches up with GET /api/v1/cancellations.
// At least once: a crash between sending and logging sends it again, with the same webhook-id.
// Nothing here logs the address: a failure carries a code, and log lines name the host only.

export const WEBHOOK_RETRY_LIMIT = 6;

export interface WebhookDeliverDeps {
  transport: WebhookTransport;
  secret: string | undefined; // INTEGRATIONS_SECRET
  clock: Clock;
  logger?: Logger;
}

export type WebhookDeliverResult =
  | { status: "delivered"; type: WebhookType }
  | { status: "failed"; code: WebhookFailureCode | "not_configured" } // the last try: logged
  | { status: "no_webhook" } // the address was removed: nothing sent
  | { status: "gone" }; // nothing to tell (no such entry, booking or strike in this firm)

export class WebhookNotConfigured extends Error {
  constructor() {
    super("INTEGRATIONS_SECRET isn't set: webhooks can't be signed");
    this.name = "WebhookNotConfigured";
  }
}

const isLastTry = (attempt: JobAttempt) =>
  attempt.retryCount >= (attempt.retryLimit ?? WEBHOOK_RETRY_LIMIT);

export async function runWebhookDelivery(
  payload: WebhookDeliverPayload,
  run: WithFirm,
  deps: WebhookDeliverDeps,
  attempt: JobAttempt,
): Promise<WebhookDeliverResult> {
  const now = deps.clock.now();
  const secret = deps.secret;
  const eventRef = secret
    ? payload.logEntryId !== undefined
      ? webhookEventId(secret, payload.firmId, payload.logEntryId)
      : testEventId(secret, payload.firmId, payload.testId ?? "")
    : null;

  const prepared = await run(payload.firmId, async (tx) => {
    const [firm] = await tx
      .select({ slug: firms.slug, settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, payload.firmId));
    const hook = webhookOf(firm?.settings);
    if (!firm || !hook.url) return { status: "no_webhook" as const };
    if (!eventRef) return { status: "not_configured" as const };
    const built = await buildWebhook(tx, {
      eventId: eventRef,
      firm: { id: payload.firmId, slug: firm.slug },
      now,
      ...(payload.logEntryId !== undefined ? { logEntryId: payload.logEntryId } : {}),
      ...(payload.testId !== undefined ? { testId: payload.testId } : {}),
    });
    if (built.status === "gone") return built;
    return {
      status: "send" as const,
      url: hook.url,
      version: hook.signingVersion,
      type: built.type,
      body: built.body,
      bookingId: built.bookingId,
    };
  });
  if (prepared.status === "no_webhook" || prepared.status === "gone") return prepared;

  let code: WebhookFailureCode | "not_configured" | null = null;
  let type: WebhookType | null = null;
  let bookingId: string | null = null;
  if (prepared.status === "not_configured" || !secret || !eventRef) {
    code = "not_configured";
  } else {
    type = prepared.type;
    bookingId = prepared.bookingId;
    const headers = signedHeaders(
      signingKey(secret, payload.firmId, prepared.version),
      eventRef,
      Math.floor(now.getTime() / 1000),
      prepared.body,
    );
    try {
      await deps.transport.send({
        url: prepared.url,
        headers: { ...headers },
        body: prepared.body,
      });
    } catch (err) {
      code = err instanceof WebhookSendError ? err.code : "connection";
      (deps.logger ?? log).warn("webhook not delivered", {
        firmId: payload.firmId,
        host: addressHost(prepared.url),
        code,
        retryCount: attempt.retryCount,
      });
    }
  }

  if (code === null && type && eventRef) {
    const delivered = type;
    await run(payload.firmId, (tx) =>
      recordEvent(tx, {
        actorType: "system",
        action: "webhook.delivered",
        ...(bookingId
          ? { entityType: "assignment", entityId: bookingId }
          : { entityType: "firm", entityId: payload.firmId }),
        data: { eventRef, ...(bookingId ? { bookingId } : {}), type: delivered },
      }),
    );
    return { status: "delivered", type: delivered };
  }
  const failure = code ?? "connection";
  // Not the last try: pg-boss tries again after its wait. A code only, never the address.
  if (!isLastTry(attempt)) {
    if (failure === "not_configured") throw new WebhookNotConfigured();
    throw new WebhookSendError(failure);
  }
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: "webhook.failed",
      ...(bookingId
        ? { entityType: "assignment", entityId: bookingId }
        : { entityType: "firm", entityId: payload.firmId }),
      data: {
        ...(eventRef ? { eventRef } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...(type ? { type } : {}),
        code: failure,
      },
    }),
  );
  return { status: "failed", code: failure };
}

export function createWebhookDeliverTask(
  deps: () => WebhookDeliverDeps,
): FirmTask<WebhookDeliverPayload> {
  return {
    queue: WEBHOOK_DELIVER_QUEUE,
    schema: webhookDeliverPayload,
    task: (payload, run, attempt) => runWebhookDelivery(payload, run, deps(), attempt),
  };
}

const workerDeps = (): WebhookDeliverDeps => {
  const env = workerEnv();
  return {
    transport: webhookTransport(env.WEBHOOK_TRANSPORT),
    secret: env.INTEGRATIONS_SECRET,
    clock: systemClock,
  };
};
export const webhookDeliverTask = createWebhookDeliverTask(workerDeps);
