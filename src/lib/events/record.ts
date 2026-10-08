import { activeFirmId, type FirmTx } from "../db/scoped";
import { events } from "../db/schema";
import { redact } from "../log/mask";

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

// Returns the new event's id (a job can then carry it instead of the event's details).
export async function recordEvent(tx: FirmTx, event: EventInput): Promise<number> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("recordEvent must be called inside withFirm");
  const [row] = await tx
    .insert(events)
    .values(eventRow(firmId, event))
    .returning({ id: events.id });
  if (!row) throw new Error("event insert returned nothing");
  return row.id;
}

// Many events at once (one per row a bulk change touched: the pay queries in a digest, say), with
// the same check on each, in inserts of up to 500 rows. Every event is checked before any is written.
export async function recordEvents(tx: FirmTx, list: EventInput[]): Promise<void> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("recordEvents must be called inside withFirm");
  const rows = list.map((event) => eventRow(firmId, event));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(events).values(rows.slice(i, i + 500));
  }
}
