"use server";

import { getWorkerSession } from "@/lib/auth/current-worker";
import { removeMyTravel, saveMyTravel } from "@/lib/portal/travel";
import type { RemoveTravelOutcome, SaveTravelOutcome } from "@/lib/portal/travel-copy";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Where you work": save or remove the travel area. The firm comes from the request's host and the
// casual from their session; the browser sends only the postcode, how they travel and the limit
// (checked again in saveMyTravel). Errors are logged without the postcode.

export async function saveTravelAction(
  postcode: unknown,
  modes: unknown,
  maxMinutes: unknown,
): Promise<SaveTravelOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  try {
    return await saveMyTravel({ firm }, session.worker.id, { postcode, modes, maxMinutes });
  } catch (error) {
    (await requestLog()).error("save travel area failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export async function removeTravelAction(): Promise<RemoveTravelOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  try {
    return await removeMyTravel({ firm }, session.worker.id);
  } catch (error) {
    (await requestLog()).error("remove travel area failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
