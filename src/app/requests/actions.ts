"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { markAnswersSeen } from "@/lib/portal/request-answers";
import {
  attendancePayload,
  requestPayload,
  WORKER_REQUEST_KINDS,
  type AttendanceOutcome,
  type CreateRequestOutcome,
  type WithdrawOutcome,
} from "@/lib/portal/request-kinds";
import { askAboutMark, createRequest, withdrawRequest } from "@/lib/portal/requests";
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

// "Send to the office" on "Tell the office what happened" (Phase 28.13): an attendance question
// about one of her own sessions marked in the last 90 days. The firm comes from the host and the
// worker from her session; the browser sends only which shift, what she says happened and her
// note, all checked here (attendancePayload: no phone number or email address in the note).
// askAboutMark (src/lib/portal/requests.ts) checks the booking again, keeps one waiting question
// per session, logs request.created and never changes the mark.
const attendanceSchema = z.object({
  shiftId: z.uuid(),
  fields: z.strictObject({
    said: z.string().max(20),
    note: z.string().max(1000).optional(),
  }),
});

export async function askAboutMarkAction(
  shiftId: string,
  fields: Record<string, string>,
): Promise<AttendanceOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = attendanceSchema.safeParse({ shiftId, fields });
  if (!input.success) return { status: "invalid" };
  const payload = attendancePayload({
    said: input.data.fields.said,
    note: input.data.fields.note ?? "",
  });
  if (!payload) return { status: "invalid" };
  try {
    return await askAboutMark({ firm }, session.worker.id, {
      shiftId: input.data.shiftId,
      payload,
    });
  } catch (error) {
    (await requestLog()).error("ask about mark failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

// "Yes, take it back" (Phase 28.9): her own request, while it's still waiting for the office. The
// firm comes from the host and the worker from her session; the browser sends only the request's
// id, checked here. withdrawRequest (src/lib/portal/requests.ts) is one conditional UPDATE: if the
// office answered first, nothing changes and she's told so.
export async function withdrawRequestAction(requestId: string): Promise<WithdrawOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const id = z.uuid().safeParse(requestId);
  if (!id.success) return { status: "not_yours" };
  try {
    return await withdrawRequest({ firm }, session.worker.id, id.data);
  } catch (error) {
    (await requestLog()).error("withdraw request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export type AnswersSeenOutcome =
  { status: "seen"; moved: boolean } | { status: "logged_out" } | { status: "error" };

// Her requests' answers are on her screen (Phase 28.9; src/app/requests/answers-seen.tsx calls it
// once the list shows, never while the page is made, so a prefetch can't clear the count). Marks
// seen only the answers given by `shownAt`, when the page was made (never later than now:
// markAnswersSeen caps it), so one that arrives after still counts. Her own row only.
export async function markAnswersSeenAction(shownAt: string): Promise<AnswersSeenOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const at = z.iso.datetime().safeParse(shownAt);
  if (!at.success) return { status: "error" };
  try {
    const moved = await markAnswersSeen({ firm }, session.worker.id, new Date(at.data));
    return { status: "seen", moved };
  } catch (error) {
    (await requestLog()).error("mark answers seen failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
