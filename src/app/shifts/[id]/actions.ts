"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { MAX_REQUEST_NOTE, type ReviewOutcome } from "@/lib/portal/request-kinds";
import { askForReview } from "@/lib/portal/review";
import { confirmStillComing, type StillComingOutcome } from "@/lib/portal/still-coming";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Ask the office to review". The firm comes from the request's host and the worker from their
// session; the browser sends only the shift and the optional note.
export async function askForReviewAction(shiftId: string, note: string): Promise<ReviewOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  // Not a shift id: nothing to review. A note that isn't text, or far too long: the note's answer.
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "not_open" };
  const text = z
    .string()
    .max(MAX_REQUEST_NOTE * 2)
    .safeParse(note);
  if (!text.success) return { status: "invalid" };
  try {
    return await askForReview({ firm }, session.worker.id, id.data, text.data);
  } catch (error) {
    (await requestLog()).error("ask for review failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

// "Yes, I'm coming" (Phase 28.14; docs/screens.md "The casual app, Phase 28" 28.14), on the pass
// and the shift's page in the day before a booked shift. The firm comes from the request's host and
// the casual from her session; the browser sends only the shift. One conditional UPDATE and one
// shift.still_coming event (confirmStillComing, 28.2); a second tap answers "already" with the same
// time. Nothing else follows: no strike, reliability figure, offer or watch list reads it.
export async function stillComingAction(shiftId: string): Promise<StillComingOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "not_now" };
  try {
    return await confirmStillComing({ firm }, session.worker.id, id.data);
  } catch (error) {
    (await requestLog()).error("still coming failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
