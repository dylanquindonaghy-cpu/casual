"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import type { OfficeContext } from "@/lib/office/office-context";
import { removeContract, saveContract, type ContractResult } from "@/lib/office/contracts";
import { editSitePostcode, type EditSitePostcodeResult } from "@/lib/office/settings-page";
import { saveStrikesEmail, type SaveStrikesEmailResult } from "@/lib/office/strikes-email";
import { requestLog } from "@/lib/request";

// Settings (docs/screens.md `/office/settings`; 12B.7). The firm comes from the request's host and
// the office user from their session: admins only, checked here and again inside each change.
// Input is checked with zod first. Results are shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asAdmin<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "settings")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function saveStrikesEmailAction(
  address: unknown,
): Promise<SaveStrikesEmailResult | Common> {
  if (typeof address !== "string" || address.length > 1000) return { status: "invalid" };
  return asAdmin("save strikes email", (ctx) => saveStrikesEmail(ctx, { address }));
}

export async function editSitePostcodeAction(
  siteId: unknown,
  postcode: unknown,
): Promise<EditSitePostcodeResult | Common> {
  if (!z.uuid().safeParse(siteId).success) return { status: "not_found" };
  if (typeof postcode !== "string") return { status: "invalid" };
  return asAdmin("edit site postcode", (ctx) =>
    editSitePostcode(ctx, siteId as string, { postcode }),
  );
}

// Contracts (Phase 26.3): add one (no id) or save one (its name, and the venues ticked or unticked
// against `before`, those it had when the form was loaded), and remove one. Checked again inside
// (src/lib/office/contracts.ts), each logged.
export async function saveContractAction(
  clientId: unknown,
  name: unknown,
  siteIds: unknown,
  before: unknown = [],
): Promise<ContractResult | Common> {
  if (clientId !== null && !z.uuid().safeParse(clientId).success) return { status: "not_found" };
  if (typeof name !== "string" || name.length > 1000) return { status: "invalid" };
  if (!Array.isArray(siteIds) || siteIds.length > 500) return { status: "invalid" };
  if (!Array.isArray(before) || before.length > 500) return { status: "invalid" };
  return asAdmin("save contract", (ctx) =>
    saveContract(ctx, { clientId: clientId as string | null, name, siteIds, before }),
  );
}

export async function removeContractAction(clientId: unknown): Promise<ContractResult | Common> {
  if (!z.uuid().safeParse(clientId).success) return { status: "not_found" };
  return asAdmin("remove contract", (ctx) => removeContract(ctx, clientId as string));
}
