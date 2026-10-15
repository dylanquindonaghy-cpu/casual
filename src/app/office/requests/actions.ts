"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { answerRequest } from "@/lib/office/quick-actions";
import { REQUEST_DECISIONS, type ResolveRequestResult } from "@/lib/requests/resolve";
import { requestLog } from "@/lib/request";

// Answering a worker's request (docs/screens.md `/office/requests`). The firm comes from the
// request's host and the office user from their session (an admin or resourcer: checked here, and
// again inside the change). Input is checked with zod first. The result is shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

// The note's length (500 once trimmed) is resolveRequest's to check, so it has one answer.
const input = z.strictObject({
  requestId: z.uuid(),
  decision: z.enum(REQUEST_DECISIONS),
  note: z.string().max(20_000),
});

export async function answerRequestAction(raw: unknown): Promise<ResolveRequestResult | Common> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    const note = (raw as { note?: unknown } | null)?.note;
    return typeof note === "string" && note.length > 20_000
      ? { status: "note_too_long" }
      : { status: "not_found" };
  }
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "enquiries")) return { status: "not_allowed" };
  const { requestId, decision, note } = parsed.data;
  try {
    return await answerRequest(
      { firm: session.firm, officeUserId: session.officeUser.id },
      requestId,
      decision,
      note,
    );
  } catch (error) {
    (await requestLog()).error("answer request failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}
