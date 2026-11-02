"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { saveTellMe } from "@/lib/office/tell-me";
import type { TellMeResult } from "@/lib/office/tell-me-copy";
import { requestLog } from "@/lib/request";

// A "Tell me about" switch flipped on Updates (Phase 26.4): saved to the person and logged.
export async function saveTellMeAction(kind: string, on: boolean): Promise<TellMeResult> {
  const session = await getOfficeSession();
  if (!session) return { status: "not_allowed" };
  try {
    return await saveTellMe(
      { firm: session.firm, officeUserId: session.officeUser.id },
      { kind, on },
    );
  } catch (error) {
    (await requestLog()).error("save tell me failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
