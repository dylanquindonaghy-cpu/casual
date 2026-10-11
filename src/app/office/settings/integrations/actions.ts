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
import { requestLog } from "@/lib/request";

// Integrations (docs/screens.md `/office/settings/integrations`; 12J.1). The firm comes from the
// request's host and the office user from their session: admins only, checked here and again
// inside each change. A new key comes back in the create answer only, once; it is never logged.

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
