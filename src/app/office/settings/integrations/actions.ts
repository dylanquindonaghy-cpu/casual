"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import {
  createApiKey,
  revokeApiKey,
  type CreateApiKeyResult,
  type RevokeApiKeyResult,
} from "@/lib/office/integrations";
import type { OfficeContext } from "@/lib/office/office-context";
import {
  addWebhook,
  removeWebhook,
  renewSigningSecret,
  sendTestWebhook,
  type AddWebhookResult,
  type RemoveWebhookResult,
  type RenewSecretResult,
  type TestWebhookResult,
} from "@/lib/office/webhook-settings";
import { requestLog } from "@/lib/request";

// Integrations (docs/screens.md `/office/settings/integrations`; 12J.1). The firm comes from the
// request's host and the office user from their session: admins only, checked here and again
// inside each change. A new key, and a webhook's signing secret (12J.2), come back in the answer
// only, once; neither is ever logged, and nor is the webhook's address.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asAdmin<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "integrations")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function createApiKeyAction(label: unknown): Promise<CreateApiKeyResult | Common> {
  if (typeof label !== "string" || label.length > 1000) return { status: "invalid" };
  return asAdmin("create api key", (ctx) => createApiKey(ctx, { label }));
}

export async function revokeApiKeyAction(keyId: unknown): Promise<RevokeApiKeyResult | Common> {
  return asAdmin("revoke api key", (ctx) => revokeApiKey(ctx, { keyId }));
}

export async function addWebhookAction(address: unknown): Promise<AddWebhookResult | Common> {
  if (typeof address !== "string" || address.length > 1000) {
    return { status: "invalid", problem: "not_an_address" };
  }
  return asAdmin("add webhook", (ctx) => addWebhook(ctx, { address }));
}

export async function renewSigningSecretAction(): Promise<RenewSecretResult | Common> {
  return asAdmin("renew webhook secret", (ctx) => renewSigningSecret(ctx));
}

export async function sendTestWebhookAction(): Promise<TestWebhookResult | Common> {
  return asAdmin("send test webhook", (ctx) => sendTestWebhook(ctx));
}

export async function removeWebhookAction(): Promise<RemoveWebhookResult | Common> {
  return asAdmin("remove webhook", (ctx) => removeWebhook(ctx));
}
