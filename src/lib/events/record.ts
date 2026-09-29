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

// Returns the new event's id (a job can then carry it instead of the event's details).
export async function recordEvent(tx: FirmTx, event: EventInput): Promise<number> {
  const firmId = activeFirmId();
  if (!firmId) throw new Error("recordEvent must be called inside withFirm");
  const data = event.data ?? {};
  if (JSON.stringify(redact(data)) !== JSON.stringify(data)) {
    throw new Error(`events.data for ${event.action} holds personal or secret data`);
  }
  const [row] = await tx
    .insert(events)
    .values({
      firmId,
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      data,
    })
    .returning({ id: events.id });
  if (!row) throw new Error("event insert returned nothing");
  return row.id;
}
