"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { requestLog } from "@/lib/request";
import { markOfficeTourSeen, TourOutcomeSchema } from "@/lib/tour/seen";

// The office's first-login tour (Phase 33.1): finished or skipped, so it doesn't open by itself
// again. Always the session's own office user: nothing from the browser names who.
export async function markOfficeTourSeenAction(outcome: string): Promise<{
  status: "seen" | "not_allowed" | "error";
}> {
  const session = await getOfficeSession();
  // Only where the tour is offered (the roles with a dashboard); checked again in the transaction.
  if (!session || !canAccess(session.officeUser.role, "today")) return { status: "not_allowed" };
  const parsed = TourOutcomeSchema.safeParse(outcome);
  if (!parsed.success) return { status: "error" };
  try {
    const r = await markOfficeTourSeen({ firm: session.firm }, session.officeUser.id, parsed.data);
    return { status: r === "marked" || r === "already" ? "seen" : "not_allowed" };
  } catch (error) {
    (await requestLog()).error("mark office tour seen failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
