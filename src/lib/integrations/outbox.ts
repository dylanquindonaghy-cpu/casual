import { sql } from "drizzle-orm";
import { z } from "zod";
import type { FirmTx } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";

// The action log is the outbox (docs/office-v2.md 5.3.3; 12J.2). recordEvent() calls
// queueWebhooks() for the three entries a planner hears about. When the firm has a webhook address,
// one `webhook-deliver` job is queued in the same transaction as the entry, so a rollback queues
// nothing and every booking or cancellation path (the app, the office, the rota sheet, the planner's
// own API calls) is covered without each remembering to. The job carries ids only: the body is
// built from the rows when it is sent (src/lib/integrations/deliver.ts), so nothing personal sits
// in the queue, an erasure needs no extra work and a late retry shows the booking as it is now.
// recordEvents() (bulk, no ids back) refuses these actions, so a future bulk path can't skip a
// delivery silently.

export const WEBHOOK_DELIVER_QUEUE = "webhook-deliver";

// Each entry and the webhook it becomes.
export const WEBHOOK_TYPES = {
  "shift.assigned": "booking.created",
  "shift.cancelled": "booking.cancelled",
  "strike.withdrawn": "strike.withdrawn",
} as const;
export type WebhookAction = keyof typeof WEBHOOK_TYPES;
export type WebhookType = (typeof WEBHOOK_TYPES)[WebhookAction] | "test.ping";

export const isWebhookAction = (action: string): action is WebhookAction =>
  Object.hasOwn(WEBHOOK_TYPES, action);

// The firm's webhook as stored (settings.webhook, written only by app_set_firm_setting():
// migration 0047): the address, and the version its signing secret is derived from.
export interface WebhookSetting {
  url: string | null;
  signingVersion: number;
}

export function webhookOf(settings: Record<string, unknown> | null | undefined): WebhookSetting {
  const raw = settings?.webhook;
  if (typeof raw !== "object" || raw === null) return { url: null, signingVersion: 0 };
  const { url, signing_version: version } = raw as Record<string, unknown>;
  return {
    url: typeof url === "string" && url.startsWith("https://") ? url : null,
    signingVersion: typeof version === "number" && Number.isInteger(version) ? version : 0,
  };
}

// The job's key names what it delivers, in base 36 (no long runs of digits): a log entry, or a
// test ("Send test event", by its random id).
const keyFor = (p: { logEntryId?: number; testId?: string }) =>
  p.logEntryId !== undefined
    ? `webhook:log:${p.logEntryId.toString(36)}`
    : `webhook:test:${p.testId}`;

export const webhookDeliverPayload = firmJobEnvelope
  .extend({
    idempotencyKey: z.string().regex(/^webhook:(log:[0-9a-z]{1,13}|test:[0-9a-f-]{36})$/),
    logEntryId: z.number().int().positive().optional(),
    testId: z.uuid().optional(),
  })
  .refine(
    (p) => (p.logEntryId === undefined) !== (p.testId === undefined),
    "a delivery is of one log entry or one test",
  )
  .refine((p) => p.idempotencyKey === keyFor(p), "the key must name what is delivered");
export type WebhookDeliverPayload = z.infer<typeof webhookDeliverPayload>;

const job = { queue: WEBHOOK_DELIVER_QUEUE, schema: webhookDeliverPayload };

// One firm's deliveries are one group: the worker runs at most one of a group at a time
// (localGroupConcurrency 1), so a slow or hanging endpoint holds up only its own firm.
// sendFirmJob() prefixes the group with the firm's id.
const GROUP = { group: { id: "webhook" } };

async function webhookAddressSet(tx: FirmTx): Promise<boolean> {
  const { rows } = await tx.execute<{ url: string | null }>(sql`
    select f.settings -> 'webhook' ->> 'url' as url from firms f where f.id = app_current_firm_id()
  `);
  return Boolean(rows[0]?.url);
}

// Called by recordEvent() with the entry it just wrote. True when a delivery was queued.
export async function queueWebhooks(
  tx: FirmTx,
  logEntryId: number,
  action: string,
): Promise<boolean> {
  if (!isWebhookAction(action)) return false;
  if (!(await webhookAddressSet(tx))) return false;
  await sendFirmJob(tx, job, { idempotencyKey: keyFor({ logEntryId }), logEntryId }, GROUP);
  return true;
}

// "Send test event" on the Integrations page: a test.ping delivery, queued like any other (the web
// app never sends to the internet itself). False when there's no address.
export async function queueTestWebhook(tx: FirmTx, testId: string): Promise<boolean> {
  if (!(await webhookAddressSet(tx))) return false;
  await sendFirmJob(tx, job, { idempotencyKey: keyFor({ testId }), testId }, GROUP);
  return true;
}
