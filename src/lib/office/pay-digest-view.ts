import { eq, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { firms } from "../db/schema";
import { loadDigestStatus, type DigestStatus } from "../pay/digest";
import { digestSchedule, type DigestSchedule } from "../pay/digest-schedule";

// The digest part of payroll's page (docs/screens.md `/office/pay-queries`): when it goes, the last
// one sent, and anything since that didn't go. Payroll and admins: checked here as well as on the
// page.

export interface PayDigestView {
  timeZone: string;
  schedule: DigestSchedule;
  status: DigestStatus;
}

export async function officePayDigestView(
  ctx: AuthContext,
  token: string,
): Promise<PayDigestView | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "pay")) return null;
  const { run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const [firm] = await tx
      .select({ timezone: firms.timezone, settings: firms.settings })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    return {
      timeZone: firm?.timezone ?? "Europe/London",
      schedule: digestSchedule(firm?.settings ?? {}),
      status: await loadDigestStatus(tx),
    };
  });
}
