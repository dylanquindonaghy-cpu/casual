"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { requestLog } from "@/lib/request";
import { closeEnquiry, replyToEnquiry } from "@/lib/office/enquiry-actions";
import type { CloseOutcome, ReplyOutcome } from "@/lib/office/enquiries-copy";
import type { CloseReason } from "@/lib/office/enquiry-rules";

// The office answering a message on Enquiries (docs/screens.md `/office/enquiries/[id]`; 12D.1).
// The firm comes from the request's host and the office user from their session (an admin or
// resourcer: checked here, and again inside the change, where the input is checked with zod).

export async function replyToEnquiryAction(messageId: string, text: string): Promise<ReplyOutcome> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "enquiries")) return { status: "not_allowed" };
  if (typeof messageId !== "string" || typeof text !== "string") return { status: "not_found" };
  try {
    return await replyToEnquiry(
      { firm: session.firm, officeUserId: session.officeUser.id },
      messageId,
      text,
    );
  } catch (error) {
    (await requestLog()).error("enquiry reply failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function closeEnquiryAction(
  messageId: string,
  reason: CloseReason,
): Promise<CloseOutcome> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "enquiries")) return { status: "not_allowed" };
  try {
    return await closeEnquiry(
      { firm: session.firm, officeUserId: session.officeUser.id },
      messageId,
      reason,
    );
  } catch (error) {
    (await requestLog()).error("enquiry close failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
