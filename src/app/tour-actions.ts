"use server";

import { getWorkerSession } from "@/lib/auth/current-worker";
import { requestLog } from "@/lib/request";
import { markCasualTourSeen, TourOutcomeSchema } from "@/lib/tour/seen";

// A casual's first-login tour (Phase 33.1; its steps are 33.3's): finished or skipped, so it
// doesn't open by itself again. Always the session's own casual: nothing from the browser names who.
export async function markCasualTourSeenAction(outcome: string): Promise<{
  status: "seen" | "not_allowed" | "error";
}> {
  const session = await getWorkerSession();
  if (!session) return { status: "not_allowed" };
  const parsed = TourOutcomeSchema.safeParse(outcome);
  if (!parsed.success) return { status: "error" };
  try {
    const r = await markCasualTourSeen({ firm: session.firm }, session.worker.id, parsed.data);
    return { status: r === "marked" || r === "already" ? "seen" : "not_allowed" };
  } catch (error) {
    (await requestLog()).error("mark casual tour seen failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
