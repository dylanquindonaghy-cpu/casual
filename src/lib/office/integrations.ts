import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import {
  apiKeys,
  credentialRules,
  credentialTypes,
  officeUsers,
  rosterSources,
} from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { appDatabaseIsLocal } from "../db/where";
import { recordEvent } from "../events/record";
import { AgreementNotRecorded, requireAgreementForImport } from "../imports/gate-b";
import {
  apiKeyHash,
  apiKeyHint,
  KEY_LABEL_MAX,
  MAX_LIVE_KEYS,
  newApiKey,
} from "../integrations/keys";
import { officeUserMay, parts, type OfficeContext } from "./office-context";
import { webhookStatus, type WebhookStatus } from "./webhook-settings";

// Integrations (docs/office-v2.md 5.3.4; docs/screens.md `/office/settings/integrations`; 12J.1),
// admins only, checked here as well as on the page and in the actions: how the firm's planner is
// connected, its API keys, its webhook (12J.2: src/lib/office/webhook-settings.ts) and the codes
// it may send. A key is made here and returned once, in the
// create answer: only its sha256 and its last 4 characters are stored (src/lib/integrations/keys.ts),
// and the action log holds the key's id only (`api_key.created` / `api_key.revoked` {keyId}), never
// the key or its name (typed text). A key row is never deleted: revoking stamps it, and it stops
// working at once (the look-up and the API's own check read live keys only).

// How the planner reaches ShiftDesk, for the page's one line ("Your planner").
export type PlannerLink =
  | { kind: "api"; lastChangeAt: Date } // a live key, and the latest change the API logged
  | { kind: "sheet"; syncedAt: Date | null } // the firm's Google Sheet (null: not synced yet)
  | { kind: "none" };

export interface ApiKeyRow {
  id: string;
  label: string;
  hint: string; // the key's last 4 characters
  createdBy: string; // the office user's name
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface IntegrationsPage {
  now: Date;
  planner: PlannerLink;
  keys: ApiKeyRow[]; // live keys only, oldest first
  roles: string[]; // the firm's role codes (credential_rules), for `role`
  qualifications: { code: string; name: string }[]; // for `requirements`
  // The planner's webhook (12J.2): its address as a hint ("https://hooks.example/…k3F9"), never
  // whole, and how its deliveries are going.
  webhook: { hint: string | null; status: WebhookStatus };
}

// How the planner reaches ShiftDesk, and when it last sent changes: the latest change the API
// logged while a key is live (every change it makes is logged with {via: "api"}, 5.3.2 "Logging";
// once every key is revoked the planner isn't connected any more), or else the firm's Google
// Sheet and its last sync. Integrations' line and the dashboard's "Updated … from your planner"
// (Phase 24) read it. Inside the firm's transaction (RLS); reads no key itself.
export async function plannerLink(tx: FirmTx): Promise<PlannerLink> {
  const [live] = await tx
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt))
    .limit(1);
  if (live) {
    const { rows: changed } = await tx.execute<{ at: string | Date }>(sql`
      select e.created_at as at from events e
       where e.data ->> 'via' = 'api'
       order by e.created_at desc limit 1
    `);
    const lastChange = changed[0];
    if (lastChange) return { kind: "api", lastChangeAt: new Date(lastChange.at) };
  }
  const [sheet] = await tx
    .select({ syncedAt: rosterSources.lastSyncedAt })
    .from(rosterSources)
    .where(eq(rosterSources.enabled, true));
  return sheet ? { kind: "sheet", syncedAt: sheet.syncedAt } : { kind: "none" };
}

export async function integrationsPage(ctx: OfficeContext): Promise<IntegrationsPage | null> {
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) return null;
    const keys = await tx
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        hint: apiKeys.hint,
        createdBy: officeUsers.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .innerJoin(
        officeUsers,
        and(eq(officeUsers.firmId, apiKeys.firmId), eq(officeUsers.id, apiKeys.createdBy)),
      )
      .where(isNull(apiKeys.revokedAt))
      .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id));
    const planner = await plannerLink(tx);
    const rules = await tx
      .select({ role: credentialRules.role })
      .from(credentialRules)
      .orderBy(asc(credentialRules.role));
    const qualifications = await tx
      .select({ code: credentialTypes.code, name: credentialTypes.name })
      .from(credentialTypes)
      .orderBy(asc(credentialTypes.code));
    const webhook = await webhookStatus(tx);
    return { now, planner, keys, roles: rules.map((r) => r.role), qualifications, webhook };
  });
}

// A key's name: what the admin calls it ("Event planner"), so they can tell keys apart. Trimmed;
// no control characters.
export const apiKeyLabelSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(KEY_LABEL_MAX)
    .refine((v) => !/\p{Cc}/u.test(v)),
});

export type CreateApiKeyResult =
  // The key itself, in this answer only: it is never stored, logged or shown again.
  | { status: "created"; keyId: string; key: string; label: string; hint: string }
  | { status: "invalid" }
  | { status: "too_many" } // MAX_LIVE_KEYS live keys already
  | { status: "agreement_needed" } // Gate B: a live database, the firm's agreement not recorded
  | { status: "not_allowed" };

export async function createApiKey(ctx: OfficeContext, raw: unknown): Promise<CreateApiKeyResult> {
  const parsed = apiKeyLabelSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  const { label } = parsed.data;
  const { run } = parts(ctx);
  const localDatabase = ctx.localDatabase ?? appDatabaseIsLocal();
  try {
    return await run(ctx.firm.id, async (tx): Promise<CreateApiKeyResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
        return { status: "not_allowed" };
      }
      // Gate B (golden rule 7): a planner sends real staff data, as an import does.
      await requireAgreementForImport(tx, { saving: true, localDatabase });
      // Two admins creating at once must not both see 9 live keys and make 11.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('api-keys:' || app_current_firm_id()::text, 0))`,
      );
      const [live] = await tx.select({ n: count() }).from(apiKeys).where(isNull(apiKeys.revokedAt));
      if ((live?.n ?? 0) >= MAX_LIVE_KEYS) return { status: "too_many" };
      const key = newApiKey();
      const hint = apiKeyHint(key);
      const [row] = await tx
        .insert(apiKeys)
        .values({
          firmId: ctx.firm.id,
          label,
          tokenHash: apiKeyHash(key),
          hint,
          createdBy: ctx.officeUserId,
        })
        .returning({ id: apiKeys.id });
      if (!row) throw new Error("api key insert returned nothing");
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "api_key.created",
        entityType: "api_key",
        entityId: row.id,
        data: { keyId: row.id },
      });
      return { status: "created", keyId: row.id, key, label, hint };
    });
  } catch (error) {
    if (error instanceof AgreementNotRecorded) return { status: "agreement_needed" };
    throw error;
  }
}

export const revokeApiKeySchema = z.strictObject({ keyId: z.uuid() });

export type RevokeApiKeyResult =
  | { status: "revoked" }
  | { status: "already_revoked" }
  | { status: "not_found" } // no such key in this firm (another firm's looks the same)
  | { status: "not_allowed" };

export async function revokeApiKey(ctx: OfficeContext, raw: unknown): Promise<RevokeApiKeyResult> {
  const parsed = revokeApiKeySchema.safeParse(raw);
  if (!parsed.success) return { status: "not_found" };
  const { keyId } = parsed.data;
  const { run } = parts(ctx);
  const now = (ctx.clock ?? systemClock).now();
  return run(ctx.firm.id, async (tx): Promise<RevokeApiKeyResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "integrations"))) {
      return { status: "not_allowed" };
    }
    // The row lock waits for an API call already using the key (it holds the key "for share" in
    // its own transaction), so nothing the key does lands after the revocation.
    const [key] = await tx
      .select({ revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .for("update");
    if (!key) return { status: "not_found" };
    if (key.revokedAt) return { status: "already_revoked" };
    await tx
      .update(apiKeys)
      .set({ revokedAt: now, revokedBy: ctx.officeUserId })
      .where(eq(apiKeys.id, keyId));
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: keyId,
      data: { keyId },
    });
    return { status: "revoked" };
  });
}
