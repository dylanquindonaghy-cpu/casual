"use server";

import { z } from "zod";
import { readWorkerSessionToken } from "@/lib/auth/session-cookie";
import {
  requestStepUpCode,
  verifyStepUpCode,
  type RequestCodeResult,
  type VerifyCodeResult,
} from "@/lib/auth/step-up";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// Pay-page step-up. The browser navigates itself afterwards (no redirect() in actions).

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
