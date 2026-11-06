"use server";

import { z } from "zod";
import { getWorkerSession, steppedUpWorker } from "@/lib/auth/current-worker";
import { readWorkerSessionToken } from "@/lib/auth/session-cookie";
import {
  requestStepUpCode,
  verifyStepUpCode,
  type RequestCodeResult,
  type VerifyCodeResult,
} from "@/lib/auth/step-up";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { seePayAnswers } from "@/lib/portal/pay-queries";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// Pay-page step-up (on /pay and, since Phase 28.10, on /pay/query too: the same throttle, the same
// 10-minute code and 30 minutes open). The browser navigates itself afterwards (no redirect() in
// actions), only to a path its page worked out (payQueryPath in src/lib/portal/pay-query-kinds.ts).

export async function requestCodeAction(): Promise<RequestCodeResult | { status: "error" }> {
  const firm = await getCurrentFirm();
  const token = await readWorkerSessionToken();
  if (!token) return { status: "logged_out" };
  try {
    return await requestStepUpCode({ firm }, token);
  } catch (error) {
    (await requestLog()).error("code request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export async function verifyCodeAction(
  code: string,
): Promise<VerifyCodeResult | { status: "error" }> {
  const firm = await getCurrentFirm();
  const token = await readWorkerSessionToken();
  if (!token) return { status: "logged_out" };
  const typed = z.string().max(20).safeParse(code);
  if (!typed.success) return { status: "invalid_code" };
  try {
    return await verifyStepUpCode({ firm }, token, typed.data);
  } catch (error) {
    (await requestLog()).error("code check failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

// Payroll's answers are on her screen (Phase 28.10; src/app/pay/pay-answers-seen.tsx): mark them
// seen, so the Pay tab's count goes. Only for a session that passed the code in the last 30
// minutes (the answers show nowhere else), and only up to when the page was drawn (`shownAt`, the
// page's own clock, sent with it), so an answer sorted since still counts.
const ShownAt = z.iso.datetime();

export type SeenPayAnswersResult = {
  status: "seen" | "nothing_new" | "needs_code" | "logged_out" | "error";
};

export async function markPayAnswersSeenAction(shownAt: string): Promise<SeenPayAnswersResult> {
  const firm = await getCurrentFirm();
  if (!(await getWorkerSession())) return { status: "logged_out" };
  const stepped = await steppedUpWorker();
  if (!stepped) return { status: "needs_code" };
  const at = ShownAt.safeParse(shownAt);
  if (!at.success) return { status: "error" };
  try {
    const moved = await seePayAnswers({ firm }, stepped, new Date(at.data));
    return { status: moved ? "seen" : "nothing_new" };
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "needs_code" };
    (await requestLog()).error("pay answers seen failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
