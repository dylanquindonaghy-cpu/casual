import { activeFirmId, type FirmTx } from "../db/scoped";
import { events } from "../db/schema";
import { isWebhookAction, queueWebhooks } from "../integrations/outbox";
import { redact } from "../log/mask";
import { WORKER_LIST_ACTIONS } from "./worker-lists";

// The action log (golden rule 5): one append-only row per state change, written in the same
// transaction as the change. data holds ids, reasons and flags only: never a token, code, phone
// number, email, name or IP. Anything the log masker would change is refused.

export type ActorType = "worker" | "office" | "system" | "ai";

export interface EventInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string; // e.g. "auth.login", "shift.assigned"
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

// The check every entry passes: the log masker would leave it exactly as it is (a test passes each
// new entry's sample data through it, docs/office-v2.md 6.1).
export function passesLogCheck(data: Record<string, unknown>): boolean {
  return JSON.stringify(redact(data)) === JSON.stringify(data);
}

function eventRow(firmId: string, event: EventInput) {
  const data = event.data ?? {};
  if (!passesLogCheck(data)) {
    throw new Error(`events.data for ${event.action} holds personal or secret data`);
  }
  if ("workers" in data && !WORKER_LIST_ACTIONS.includes(event.action)) {
    throw new Error(`events.data for ${event.action} lists workers: add it to WORKER_LIST_ACTIONS`);
  }
  return {
    firmId,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    data,
  };
}

// Returns the new event's id (a job can then carry it instead of the event's details). A booking,
// a cancellation or a withdrawn strike also queues the firm's planner webhook, in this same
// transaction, when the firm has one (the action log is the outbox: src/lib/integrations/outbox.ts).
export async function recordEvent(tx: FirmTx, event: EventInput): Promise<number> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("recordEvent must be called inside withFirm");
  const [row] = await tx
    .insert(events)
    .values(eventRow(firmId, event))
    .returning({ id: events.id });
  if (!row) throw new Error("event insert returned nothing");
  if (isWebhookAction(event.action)) await queueWebhooks(tx, row.id, event.action);
  return row.id;
}

// Many events at once (one per row a bulk change touched: the pay queries in a digest, say), with
// the same check on each, in inserts of up to 500 rows. Every event is checked before any is written.
// Never a booking, cancellation or withdrawn strike: those queue a webhook each (recordEvent), and
// this returns no ids to queue them with, so a bulk path can't skip a delivery silently.
export async function recordEvents(tx: FirmTx, list: EventInput[]): Promise<void> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("recordEvents must be called inside withFirm");
  const outboxed = list.find((event) => isWebhookAction(event.action));
  if (outboxed) {
    throw new Error(
      `recordEvents can't write ${outboxed.action}: use recordEvent (it queues a webhook)`,
    );
  }
  const rows = list.map((event) => eventRow(firmId, event));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(events).values(rows.slice(i, i + 500));
  }
}
