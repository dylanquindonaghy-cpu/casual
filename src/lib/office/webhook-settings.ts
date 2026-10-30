import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { resolveFirmByDomain, type ResolveFirmByDomain } from "../db/directory";
import type { FirmTx } from "../db/scoped";
import { appDatabaseIsLocal } from "../db/where";
import { appEnv } from "../env";
import { recordEvent } from "../events/record";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import { queueTestWebhook, webhookOf } from "../integrations/outbox";
import {
  addressHint,
  checkWebhookAddress,
  MAX_ADDRESS_LENGTH,
  type AddressProblem,
} from "../integrations/send";
import { signingSecret } from "../integrations/secrets";
import { readWebhookStatusRow, webhookAddressSet } from "../integrations/status";
import { officeUserMay, parts, type OfficeContext } from "./office-context";

// The planner's webhook on the Integrations page (docs/office-v2.md 5.3.4; 12J.2), admins only,
// checked inside the firm's transaction. The address goes in only through app_set_firm_setting()
// (migration 0047), which adds 1 to the signing version on each add, change, removal and "New
// signing secret": the secret is derived from it (src/lib/integrations/secrets.ts), shown once, in
// the answer to the add or the renewal, and never stored, so an old one stops at once.
//
// The address is a secret (a catch-hook address carries its key in the path): the page shows its
// host and last 4 characters, and the log `firm.settings_changed` holds the key `webhook.url` only,
// with the signing version's old and new numbers and what changed. Adding needs Gate B, as creating
// an API key does: the webhook sends staff names out. "Send test event" queues a test.ping
// delivery: the web app never sends to the internet itself.

export const webhookAddressSchema = z.strictObject({
  address: z.string().max(MAX_ADDRESS_LENGTH * 2),
});

type Common = { status: "not_allowed" };

export type AddWebhookResult =
  // The signing secret, in this answer only.
  | { status: "added"; secret: string; hint: string }
  | { status: "unchanged" } // the same address is already set: the secret stays as it is
  | { status: "invalid"; problem: AddressProblem | "firm_domain" }
  | { status: "agreement_needed" }
  | { status: "not_configured" } // INTEGRATIONS_SECRET isn't set: nothing to sign with
  | Common;

export type RenewSecretResult =
  | { status: "renewed"; secret: string }
  | { status: "no_webhook" }
  | { status: "not_configured" }
  | Common;

export type RemoveWebhookResult = { status: "removed" } | { status: "no_webhook" } | Common;

export type TestWebhookResult =
  | { status: "queued" }
  | { status: "too_soon" } // one was queued in the last 30 seconds
  | { status: "no_webhook" }
  | Common;

export interface WebhookContext extends OfficeContext {
  secret?: string | undefined; // INTEGRATIONS_SECRET (tests pass their own)
  baseDomain?: string;
  resolveDomain?: ResolveFirmByDomain;
}

const env = (ctx: WebhookContext) => {
  const e = ctx.secret === undefined || ctx.baseDomain === undefined ? appEnv() : null;
  return {
    secret: ctx.secret ?? e?.INTEGRATIONS_SECRET,
    baseDomain: ctx.baseDomain ?? e?.APP_BASE_DOMAIN ?? "",
  };
};

// The firm's webhook as stored, read in its transaction.
async function current(tx: FirmTx) {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> | null }>(sql`
    select f.settings from firms f where f.id = app_current_firm_id()
  `);
  return webhookOf(rows[0]?.settings);
}

// Two admins at once: one after the other, so each answer's secret is the one in force.
const lockWebhook = (tx: FirmTx) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('webhook:' || app_current_firm_id()::text, 0))`,
  );

const setSetting = (tx: FirmTx, key: "webhook.url" | "webhook.rotate", value: string | null) =>
  tx.execute(sql`select app_set_firm_setting(${key}, ${value})`);

async function logChange(
  tx: FirmTx,
  ctx: OfficeContext,
  change: "added" | "replaced" | "removed" | "new_secret",
  from: number,
  to: number,
) {
  await recordEvent(tx, {
    actorType: "office",
    actorId: ctx.officeUserId,
    action: "firm.settings_changed",
    entityType: "firm",
    entityId: ctx.firm.id,
    data: {
      by: "firm",
      keys:
        change === "new_secret"
          ? ["webhook.signing_version"]
          : ["webhook.url", "webhook.signing_version"],
      webhook: change,
      from: { "webhook.signing_version": from },
      to: { "webhook.signing_version": to },
    },
  });
}

export async function addWebhook(ctx: WebhookContext, raw: unknown): Promise<AddWebhookResult> {
  const parsed = webhookAddressSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", problem: "not_an_address" };
  const { secret, baseDomain } = env(ctx);
  const checked = checkWebhookAddress(parsed.data.address, baseDomain);
  if (!checked.ok) return { status: "invalid", problem: checked.problem };
  // Not a firm's own portal domain (ours, on any firm): a webhook never points back at ShiftDesk.
  if (await (ctx.resolveDomain ?? resolveFirmByDomain)(checked.host)) {
    return { status: "invalid", problem: "firm_domain" };
  }
  if (!secret) return { status: "not_configured" };
  const { run } = parts(ctx);
  const localDatabase = ctx.localDatabase ?? appDatabaseIsLocal();
  try {
    return await run(ctx.firm.id, async (tx): Promise<AddWebhookResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
        return { status: "not_allowed" };
      }
      // Gate B (golden rule 7): the webhook sends staff names to the firm's planner.
      await requireAgreementForImport(tx, { saving: true, localDatabase });
      await lockWebhook(tx);
      const before = await current(tx);
      if (before.url === checked.url) return { status: "unchanged" };
      await setSetting(tx, "webhook.url", checked.url);
      await webhookAddressSet(tx);
      const after = await current(tx);
      await logChange(
        tx,
        ctx,
        before.url ? "replaced" : "added",
        before.signingVersion,
        after.signingVersion,
      );
      return {
        status: "added",
        secret: signingSecret(secret, ctx.firm.id, after.signingVersion),
        hint: addressHint(checked.url),
      };
    });
  } catch (error) {
    if (error instanceof AgreementNotRecorded) return { status: "agreement_needed" };
    throw error;
  }
}

export async function renewSigningSecret(ctx: WebhookContext): Promise<RenewSecretResult> {
  const { secret } = env(ctx);
  if (!secret) return { status: "not_configured" };
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx): Promise<RenewSecretResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
      return { status: "not_allowed" };
    }
    await lockWebhook(tx);
    const before = await current(tx);
    if (!before.url) return { status: "no_webhook" };
    await setSetting(tx, "webhook.rotate", null);
    const after = await current(tx);
    await logChange(tx, ctx, "new_secret", before.signingVersion, after.signingVersion);
    return { status: "renewed", secret: signingSecret(secret, ctx.firm.id, after.signingVersion) };
  });
}

export async function removeWebhook(ctx: WebhookContext): Promise<RemoveWebhookResult> {
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx): Promise<RemoveWebhookResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
      return { status: "not_allowed" };
    }
    await lockWebhook(tx);
    const before = await current(tx);
    if (!before.url) return { status: "no_webhook" };
    await setSetting(tx, "webhook.url", null);
    const after = await current(tx);
    await logChange(tx, ctx, "removed", before.signingVersion, after.signingVersion);
    return { status: "removed" };
  });
}

export async function sendTestWebhook(ctx: WebhookContext): Promise<TestWebhookResult> {
  const { run } = parts(ctx);
  return run(ctx.firm.id, async (tx): Promise<TestWebhookResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
      return { status: "not_allowed" };
    }
    return { status: await queueTestWebhook(tx, randomUUID()) };
  });
}

// ---- What the page and the dashboard show ----

export type WebhookStatus =
  | { kind: "none" } // no address
  | { kind: "new" } // an address, nothing delivered or failed since it was set
  | { kind: "working"; lastDeliveredAt: Date }
  | { kind: "failing"; since: Date };

// From the firm's status row (src/lib/integrations/status.ts; Phase 25.3), kept in step with the
// log: the latest delivery outcome since the address was last set, and while failing, the first
// failure after the last success (or the address being set).
export async function webhookStatus(
  tx: FirmTx,
): Promise<{ hint: string | null; status: WebhookStatus }> {
  const hook = await current(tx);
  if (!hook.url) return { hint: null, status: { kind: "none" } };
  const hint = addressHint(hook.url);
  const row = await readWebhookStatusRow(tx);
  if (row?.failingSince) return { hint, status: { kind: "failing", since: row.failingSince } };
  if (row?.lastDeliveredAt) {
    return { hint, status: { kind: "working", lastDeliveredAt: row.lastDeliveredAt } };
  }
  return { hint, status: { kind: "new" } };
}
