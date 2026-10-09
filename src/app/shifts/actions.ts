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
import type { CancelWarningOutcome, WhatHappenedOutcome } from "@/lib/portal/cancel-reasons";
import { cancelWarning } from "@/lib/portal/cancel-warning";
import { tellWhatHappened } from "@/lib/portal/what-happened";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

const warningSeen = z.strictObject({
  kind: z.enum(["strike", "exempt", "notice"]),
  version: z.string().min(1).max(40),
});

// The strike warning, when the casual opens the cancel step (12C.1).
export async function cancelWarningAction(shiftId: string): Promise<CancelWarningOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "not_booked" };
  try {
    return await cancelWarning({ firm }, session.worker.id, id.data);
  } catch (error) {
    (await requestLog()).error("cancel warning failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

// "Cancel this shift". The firm comes from the request's host and the worker from their session;
// the browser sends only which shift, the quick reason picked, any note and which warning was on
// screen (its kind and version: checked again against what would happen now). The browser shows
// the outcome in place (no redirect() in actions).
export async function cancelShiftAction(
  shiftId: string,
  choice: string,
  note: string,
  warning: unknown,
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
  const seen = warningSeen.safeParse(warning);
  if (!seen.success) return { status: "error" };
  try {
    return await cancelMyShift({ firm }, session.worker.id, id.data, reason, seen.data);
  } catch (error) {
    (await requestLog()).error("cancel shift failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

// "Tell us what happened", after cancelling.
export async function whatHappenedAction(
  shiftId: string,
  note: unknown,
): Promise<WhatHappenedOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  if (typeof note !== "string" || note.length > 2000) return { status: "invalid" };
  const id = z.uuid().safeParse(shiftId);
  if (!id.success) return { status: "not_cancelled" };
  try {
    return await tellWhatHappened({ firm }, session.worker.id, id.data, note);
  } catch (error) {
    (await requestLog()).error("what happened failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
