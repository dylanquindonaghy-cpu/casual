"use server";

import { getWorkerSession } from "@/lib/auth/current-worker";
import { requestLog } from "@/lib/request";
import { tourLaterKey } from "@/lib/tour/later-key";
import { markCasualTourSeen, TourOutcomeSchema } from "@/lib/tour/seen";

// A casual's first-login tour (Phase 33.1; its steps are 33.3's: src/app/casual-tour.tsx): finished
// or skipped, so it doesn't open by itself again. Always the session's own casual: nothing from the
// browser names who. In the demo's "Casual mobile view" nothing is written (Phase 33.3:
// markCasualTourSeen checks the session): "demo_view".
export async function markCasualTourSeenAction(outcome: string): Promise<{
  status: "seen" | "demo_view" | "not_allowed" | "error";
}> {
  const session = await getWorkerSession();
  if (!session) return { status: "not_allowed" };
  const parsed = TourOutcomeSchema.safeParse(outcome);
  if (!parsed.success) return { status: "error" };
  try {
    const r = await markCasualTourSeen(
      { firm: session.firm },
      session.worker.id,
      parsed.data,
      session.session.id,
    );
    if (r === "demo_view") return { status: "demo_view" };
    return { status: r === "marked" || r === "already" ? "seen" : "not_allowed" };
  } catch (error) {
    (await requestLog()).error("mark casual tour seen failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

// "Take the tour again" on Help (Phase 33.3). Help is open to anyone and its page reads no session
// (it only needs the firm from the address), so the button asks here once the page is showing: for a
// logged-in casual, what the tour needs (her firm's name, whether she's seen it, this login's "Not
// now" key); for anyone else, nothing, and no button.
export async function casualTourForHelpAction(): Promise<{
  firmName: string;
  seen: boolean;
  laterKey: string;
} | null> {
  const session = await getWorkerSession();
  if (!session) return null;
  return {
    firmName: session.firm.name,
    seen: session.tourSeen,
    laterKey: tourLaterKey(session.session.id),
  };
}
