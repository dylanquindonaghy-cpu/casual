"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import {
  requestPayload,
  WORKER_REQUEST_KINDS,
  type CreateRequestOutcome,
} from "@/lib/portal/request-kinds";
import { createRequest } from "@/lib/portal/requests";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Send request". The firm comes from the request's host and the worker from their session; the
// browser sends only which shift, the kind and the form's fields, all checked here.
const inputSchema = z.object({
  shiftId: z.uuid(),
  kind: z.enum(WORKER_REQUEST_KINDS),
  fields: z.strictObject({
    start: z.string().max(10).optional(),
    end: z.string().max(10).optional(),
    swapWith: z.string().max(200).optional(),
    note: z.string().max(1000).optional(),
  }),
});

export async function createRequestAction(
  shiftId: string,
  kind: string,
  fields: Record<string, string>,
): Promise<CreateRequestOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = inputSchema.safeParse({ shiftId, kind, fields });
  if (!input.success) return { status: "invalid" };
  const { start, end, swapWith, note } = input.data.fields;
  const payload = requestPayload(input.data.kind, {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(swapWith !== undefined ? { swapWith } : {}),
    ...(note !== undefined ? { note } : {}),
  });
  if (!payload) return { status: "invalid" };
  try {
    return await createRequest({ firm }, session.worker.id, {
      shiftId: input.data.shiftId,
      kind: input.data.kind,
      payload,
    });
  } catch (error) {
    (await requestLog()).error("create request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
