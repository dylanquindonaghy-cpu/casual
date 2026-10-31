"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { requestLog } from "@/lib/request";
import { closeEnquiry, replyToEmail, replyToEnquiry } from "@/lib/office/enquiry-actions";
import type { CloseOutcome, EmailReplyOutcome, ReplyOutcome } from "@/lib/office/enquiries-copy";
import type { CloseReason } from "@/lib/office/enquiry-rules";

// The office answering a message on Enquiries (docs/screens.md `/office/enquiries/[id]`; 12D.1), or
// an email to the staffing inbox (Phase 25.5: by email; closing is the same action).
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

export async function replyToEmailAction(
  emailId: string,
  text: string,
): Promise<EmailReplyOutcome> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "enquiries")) return { status: "not_allowed" };
  if (typeof emailId !== "string" || typeof text !== "string") return { status: "not_found" };
  try {
    return await replyToEmail(
      { firm: session.firm, officeUserId: session.officeUser.id },
      emailId,
      text,
    );
  } catch (error) {
    (await requestLog()).error("email reply failed", { firmId: session.firm.id, error });
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
