import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";

// The planner's webhook status row (`webhook_status`, Phase 25.3): what the Integrations page and
// Needs attention show, kept in step with the action log by being written in the same transaction
// as the entry it sums up. The database's clock, as the log's `created_at` is.
//
// - The address set, changed or removed (addWebhook, removeWebhook): a fresh start, nothing
//   delivered or failed since.
// - A delivery that worked (`webhook.delivered`): working, no longer failing.
// - A delivery's last try that failed (`webhook.failed`): failing since the first such failure
//   after the last delivery that worked (or the address being set).
// A firm with no row yet (its address set before the table was made) gets one with its first
// outcome.

export async function webhookAddressSet(tx: FirmTx): Promise<void> {
  await tx.execute(sql`
    insert into webhook_status (firm_id, address_set_at)
    values (app_current_firm_id(), now())
    on conflict (firm_id) do update
      set address_set_at = now(), last_delivered_at = null, failing_since = null,
          updated_at = now()
  `);
}

export async function webhookOutcome(tx: FirmTx, outcome: "delivered" | "failed"): Promise<void> {
  await tx.execute(
    outcome === "delivered"
      ? sql`
    insert into webhook_status (firm_id, address_set_at, last_delivered_at)
    values (app_current_firm_id(), now(), now())
    on conflict (firm_id) do update
      set last_delivered_at = now(), failing_since = null, updated_at = now()`
      : sql`
    insert into webhook_status (firm_id, address_set_at, failing_since)
    values (app_current_firm_id(), now(), now())
    on conflict (firm_id) do update
      set failing_since = coalesce(webhook_status.failing_since, now()), updated_at = now()`,
  );
}

export interface WebhookStatusRow {
  lastDeliveredAt: Date | null;
  failingSince: Date | null;
}

// The firm's row, or null when it has none.
export async function readWebhookStatusRow(tx: FirmTx): Promise<WebhookStatusRow | null> {
  const { rows } = await tx.execute<{
    last_delivered_at: string | Date | null;
    failing_since: string | Date | null;
  }>(sql`
    select last_delivered_at, failing_since from webhook_status
     where firm_id = app_current_firm_id()
  `);
  const row = rows[0];
  if (!row) return null;
  const date = (v: string | Date | null) => (v === null ? null : new Date(v));
  return { lastDeliveredAt: date(row.last_delivered_at), failingSince: date(row.failing_since) };
}
