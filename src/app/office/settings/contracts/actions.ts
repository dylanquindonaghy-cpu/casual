"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import {
  addClientContact,
  sendClientLoginLink,
  setClientContactOn,
  type AddContactResult,
  type SendLinkResult,
  type SwitchContactResult,
} from "@/lib/client/contacts";
import type { OfficeContext } from "@/lib/office/office-context";
import { requestLog } from "@/lib/request";

// A contract's client logins (Phase 36.3; docs/screens.md "## Phase 36"): add one, switch one off
// or on, and send one a login link. Admins only (client_logins), checked here and again inside each
// change (src/lib/client/contacts.ts, where the input is checked with zod and each change logged).
// The firm comes from the host. Results are shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asAdmin<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "client_logins")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function addClientContactAction(
  contractId: unknown,
  name: unknown,
  email: unknown,
): Promise<AddContactResult | Common> {
  if (typeof contractId !== "string") return { status: "not_found" };
  if (typeof name !== "string" || name.length > 1000) return { status: "invalid", problem: "name" };
  if (typeof email !== "string" || email.length > 1000)
    return { status: "invalid", problem: "email" };
  return asAdmin("add client login", (ctx) => addClientContact(ctx, { contractId, name, email }));
}

export async function setClientContactOnAction(
  clientContactId: unknown,
  on: unknown,
): Promise<SwitchContactResult | Common> {
  if (typeof clientContactId !== "string" || typeof on !== "boolean")
    return { status: "not_found" };
  return asAdmin("switch client login", (ctx) => setClientContactOn(ctx, { clientContactId, on }));
}

export async function sendClientLinkAction(
  clientContactId: unknown,
): Promise<SendLinkResult | Common> {
  if (typeof clientContactId !== "string") return { status: "not_found" };
  return asAdmin("send client link", (ctx) => sendClientLoginLink(ctx, clientContactId));
}
