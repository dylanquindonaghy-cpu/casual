"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { declineOffer, type DeclineOutcome } from "@/lib/portal/my-offers";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Yes, say no" on Home's "Offered to you" (Phase 28.15). The firm comes from the request's host
// and the worker from her session; the browser sends only the offer's id, checked here.
// declineOffer (src/lib/portal/my-offers.ts) is one conditional UPDATE on her own offer while it's
// still open to her: otherwise nothing changes and she's told why.
export async function declineOfferAction(offerId: string): Promise<DeclineOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(offerId);
  if (!id.success) return { status: "closed" };
  try {
    return await declineOffer({ firm }, session.worker.id, id.data);
  } catch (error) {
    (await requestLog()).error("decline offer failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
