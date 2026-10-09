"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { resendEvidenceAsOffice } from "@/lib/office/cancellations";
import type { ResendEvidenceOutcome } from "@/lib/office/evidence-copy";
import type { KeepOutcome, WithdrawOutcome } from "@/lib/office/strike-actions-copy";
import { keepStrike, withdrawStrike } from "@/lib/strikes/manage";
import { requestLog } from "@/lib/request";

// "Resend evidence" (12C.4), "Withdraw strike…" and "Keep strike" (12C.5) on a cancellation's
// record (docs/screens.md `/office/cancellations/[ref]`). The firm comes from the request's host and the office user from their session: admins
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

// The office user acting: admins and resourcers (checked here and again inside each change).
async function asStrikesOffice<T>(
  label: string,
  work: (ctx: { firm: { id: string }; officeUserId: string }) => Promise<T>,
): Promise<T | { status: "logged_out" } | { status: "not_allowed" } | { status: "error" }> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "strikes")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function withdrawStrikeAction(
  assignmentId: unknown,
  reason: unknown,
): Promise<WithdrawOutcome> {
  if (!z.uuid().safeParse(assignmentId).success) return { status: "not_found" };
  if (typeof reason !== "string" || reason.length > 5_000) return { status: "invalid" };
  return asStrikesOffice("withdraw strike", (ctx) =>
    withdrawStrike(ctx, assignmentId as string, reason),
  );
}

export async function keepStrikeAction(assignmentId: unknown): Promise<KeepOutcome> {
  if (!z.uuid().safeParse(assignmentId).success) return { status: "not_found" };
  return asStrikesOffice("keep strike", (ctx) => keepStrike(ctx, assignmentId as string));
}
