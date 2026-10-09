"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { takeShift, type TakeShiftOutcome } from "@/lib/portal/take-shift";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Take shift". The firm comes from the request's host and the worker from their session, never
// from what the browser sends: the browser only names the shift. The browser shows the outcome in
// place (no redirect() in actions).
export async function takeShiftAction(shiftId: string): Promise<TakeShiftOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "gone" };
  try {
    return await takeShift({ firm }, session.worker.id, id.data);
  } catch (error) {
    (await requestLog()).error("take shift failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
