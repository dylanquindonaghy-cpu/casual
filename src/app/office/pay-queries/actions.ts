"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { sendPayDigestNow } from "@/lib/office/quick-actions";
import type { SendDigestNowResult } from "@/lib/pay/digest";
import { requestLog } from "@/lib/request";

// Payroll's "Send the digest now" (docs/screens.md `/office/pay-queries`). The firm comes from the
// request's host and the office user from their session (payroll or an admin: checked here, and
// again inside). The digest itself goes from the job worker. The result is shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

export async function sendDigestNowAction(): Promise<SendDigestNowResult | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "pay")) return { status: "not_allowed" };
  try {
    return await sendPayDigestNow({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error("send pay digest now failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
