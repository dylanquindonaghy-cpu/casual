import { sql } from "drizzle-orm";
import { z } from "zod";
import { connectorEvents } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";
import { firmJobEnvelope, sendFirmJob } from "../jobs/firm-job";
import type { ConnectorEventIn } from "./webhook";

// Storing what a connector's source said changed (P5.3; golden rule 3): one connector_events row,
// keyed by the source's own event id (a repeat stores nothing and queues nothing), and its
// `connector-event` job, in the same transaction. The work is the job's (apply.ts), so the webhook
// answers fast. Kept apart from the handler, so the web app's route imports none of it.

export const CONNECTOR_EVENT_QUEUE = "connector-event";

// A read that fails (the source down) is tried again 5 times, from a minute later and doubling, at
// most 30 minutes apart (src/worker/jobs/queues.ts): about an hour in all. The last try records the
// event as failed and completes the job; the reconcile pull (P5.4) catches up after.
export const CONNECTOR_RETRY_LIMIT = 5;

export const connectorEventPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^connector-event:[0-9a-f-]{36}$/),
  eventId: z.uuid(), // the connector_events row's id
});
export type ConnectorEventPayload = z.infer<typeof connectorEventPayload>;

export const connectorEventJob = { queue: CONNECTOR_EVENT_QUEUE, schema: connectorEventPayload };

export function receiveConnectorEvent(
  firmId: string,
  event: ConnectorEventIn,
  deps: { run?: WithFirm } = {},
): Promise<{ stored: boolean }> {
  return (deps.run ?? withFirm)(firmId, async (tx) => {
    const [row] = await tx
      .insert(connectorEvents)
      .values({
        firmId: sql`app_current_firm_id()`,
        sourceId: event.sourceId,
        eventId: event.eventId,
        type: event.type,
        ref: event.ref,
      })
      .onConflictDoNothing({
        target: [connectorEvents.firmId, connectorEvents.sourceId, connectorEvents.eventId],
      })
      .returning({ id: connectorEvents.id });
    if (!row) return { stored: false };
    // One source's events one at a time, in the order they came (a session's changes in order).
    await sendFirmJob(
      tx,
      connectorEventJob,
      { idempotencyKey: `connector-event:${row.id}`, eventId: row.id },
      { group: { id: `source:${event.sourceId}` } },
    );
    return { stored: true };
  });
}
