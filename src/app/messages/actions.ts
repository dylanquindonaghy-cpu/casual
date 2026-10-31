"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { receiveAppMessage, type SendAppMessageOutcome } from "@/lib/inbound/app";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Send" on Messages (P8; Phase 25.6). The firm comes from the request's host and the casual from
// their session; the browser sends only the words, checked here (a box can't hold more than a few
// times the most a message may have) and the message's own id, which the form makes once and keeps
// for a repeat (src/lib/inbound/app.ts).
const inputSchema = z.string().max(20_000);
const clientIdSchema = z.uuid().optional();

export async function sendAppMessageAction(
  text: string,
  clientId?: string,
): Promise<SendAppMessageOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = inputSchema.safeParse(text);
  if (!input.success) return { status: "too_long" };
  const id = clientIdSchema.safeParse(clientId);
  if (!id.success) return { status: "error" };
  try {
    return await receiveAppMessage({ firmId: firm.id }, session.worker.id, input.data, id.data);
  } catch (error) {
    (await requestLog()).error("app message failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
