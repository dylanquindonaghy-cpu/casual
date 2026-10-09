"use server";

import { z } from "zod";
import { getWorkerSession, steppedUpWorker } from "@/lib/auth/current-worker";
import { StepUpRequiredError } from "@/lib/portal/pay";
import { payQueryInput, type RaisePayQueryOutcome } from "@/lib/portal/pay-query-kinds";
import { raisePayQuery } from "@/lib/portal/pay-queries";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Send pay query". The firm comes from the request's host and the worker from their session,
// which must have passed the pay code in the last 30 minutes (checked here and again in
// raisePayQuery). The browser sends only the form's fields, checked here.
const fieldsSchema = z.strictObject({
  shift: z.string().max(50),
  day: z.string().max(20),
  issue: z.string().max(20),
  details: z.string().max(5000),
});

export async function raisePayQueryAction(
  fields: Record<string, string>,
): Promise<RaisePayQueryOutcome> {
  const firm = await getCurrentFirm();
  if (!(await getWorkerSession())) return { status: "logged_out" };
  const stepped = await steppedUpWorker();
  if (!stepped) return { status: "needs_code" };
  const parsed = fieldsSchema.safeParse(fields);
  if (!parsed.success) return { status: "error" }; // not something the form sends
  const checked = payQueryInput(parsed.data);
  if (!checked.ok) return { status: "invalid", problems: checked.problems };
  try {
    return await raisePayQuery({ firm }, stepped, checked.input);
  } catch (error) {
    if (error instanceof StepUpRequiredError) return { status: "needs_code" };
    (await requestLog()).error("raise pay query failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
