"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { MAX_REQUEST_NOTE, type ReviewOutcome } from "@/lib/portal/request-kinds";
import { askForReview } from "@/lib/portal/review";
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
