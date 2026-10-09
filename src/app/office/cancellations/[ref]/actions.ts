"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { resendEvidenceAsOffice } from "@/lib/office/cancellations";
import type { ResendEvidenceOutcome } from "@/lib/office/evidence-copy";
import { requestLog } from "@/lib/request";

// "Resend evidence" on a cancellation's record (docs/screens.md `/office/cancellations/[ref]`;
// 12C.4). The firm comes from the request's host and the office user from their session: admins
// and resourcers, checked here and again inside the change. The booking's id is checked first.

export async function resendEvidenceAction(assignmentId: unknown): Promise<ResendEvidenceOutcome> {
  if (!z.uuid().safeParse(assignmentId).success) return { status: "not_found" };
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "cancellations")) return { status: "not_allowed" };
  try {
    return await resendEvidenceAsOffice(
      { firm: session.firm, officeUserId: session.officeUser.id },
      assignmentId as string,
    );
  } catch (error) {
    (await requestLog()).error("resend evidence failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
