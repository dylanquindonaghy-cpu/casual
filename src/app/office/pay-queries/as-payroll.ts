import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import type { OfficeContext } from "@/lib/office/office-context";
import { requestLog } from "@/lib/request";

// Runs one of payroll's page actions for the logged-in office user: the firm from the request's
// host, the user from their session (payroll or an admin: checked here, and again inside).

export type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

export async function asPayroll<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "pay")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
