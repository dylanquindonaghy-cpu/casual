"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import {
  CANCEL_REASONS,
  cancelMyShift,
  cancelReason,
  MAX_NOTE_LENGTH,
  OTHER_REASON,
  type CancelShiftOutcome,
} from "@/lib/portal/cancel-shift";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Cancel this shift". The firm comes from the request's host and the worker from their session;
// the browser sends only which shift, the quick reason picked and any note. The browser shows the
// outcome in place (no redirect() in actions).
export async function cancelShiftAction(
  shiftId: string,
  choice: string,
  note: string,
): Promise<CancelShiftOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "not_booked" };
  const input = z
    .object({
      choice: z.enum([...CANCEL_REASONS, OTHER_REASON]),
      note: z.string().max(MAX_NOTE_LENGTH),
    })
    .safeParse({ choice, note });
  const reason = input.success ? cancelReason(input.data.choice, input.data.note) : null;
  if (!reason) return { status: "invalid_reason" };
  try {
    return await cancelMyShift({ firm }, session.worker.id, id.data, reason);
  } catch (error) {
    (await requestLog()).error("cancel shift failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
