"use server";

import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { receiveAppMessage, type SendAppMessageOutcome } from "@/lib/inbound/app";
import { messageKeptShift } from "@/lib/portal/messages";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Send" on Messages (P8; Phase 25.6). The firm comes from the request's host and the casual from
// their session; the browser sends only the words, checked here (a box can't hold more than a few
// times the most a message may have) and the message's own id, which the form makes once and keeps
// for a repeat (src/lib/inbound/app.ts). Sent from Messages opened about a shift (Phase 28.6), the
// shift's id too: only a UUID gets through here, and receiveAppMessage keeps it only for a shift
// she's booked on or can see that hasn't ended (checked again there, inside the firm), so an id
// typed by hand, another firm's or one that has ended is dropped and the message sorted as any
// other. A kept one goes to a person, never the automatic sorter (src/lib/inbound/reply.ts).
// "Sent" says which (`toOffice`), from what the send stored, not from the shift the page was opened
// with: one that ended in between is sorted as any other, and may get an automatic answer.
const inputSchema = z.string().max(20_000);
const clientIdSchema = z.uuid().optional();
const shiftIdSchema = z.uuid().optional();

export type SendMessageOutcome =
  | Exclude<SendAppMessageOutcome, { status: "sent" }>
  | { status: "sent"; messageId: string; toOffice: boolean }; // toOffice: it kept its shift

export async function sendAppMessageAction(
  text: string,
  clientId?: string,
  shiftId?: string,
): Promise<SendMessageOutcome> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return { status: "logged_out" };
  const input = inputSchema.safeParse(text);
  if (!input.success) return { status: "too_long" };
  const id = clientIdSchema.safeParse(clientId);
  if (!id.success) return { status: "error" };
  // Not a shift's id: sent with none, as today.
  const about = shiftIdSchema.safeParse(shiftId);
  const askedShift = about.success ? (about.data ?? null) : null;
  let sent: SendAppMessageOutcome;
  try {
    sent = await receiveAppMessage(
      { firmId: firm.id },
      session.worker.id,
      input.data,
      id.data,
      askedShift,
    );
  } catch (error) {
    (await requestLog()).error("app message failed", { firmId: firm.id, error });
    return { status: "error" };
  }
  if (sent.status !== "sent") return sent;
  // Stored: only the words after "Sent." are still to choose. Sent about no shift, or the check
  // failing, it's "Sent. The answer comes here.", true whoever answers.
  const toOffice = askedShift
    ? await messageKeptShift({ firm }, session.worker.id, sent.messageId).catch(async (error) => {
        (await requestLog()).error("app message about check failed", { firmId: firm.id, error });
        return false;
      })
    : false;
  return { ...sent, toOffice };
}
