"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import {
  acceptClientRequest,
  askClient,
  declineClientRequest,
  markPlannerDone,
  type AcceptInput,
  type AcceptResult,
  type AnswerResult,
  type PlannerDoneResult,
} from "@/lib/client/answer";
import type { OfficeContext } from "@/lib/office/office-context";
import { requestLog } from "@/lib/request";

// The office's answers on Client requests (Phase 36.4; docs/screens.md "## Phase 36"): accept,
// decline (a reason the client sees), ask the client, and "Mark done" on the planner's to-do list.
// The firm comes from the host and the office user from their session: admins and resourcers
// (client_requests), checked here and again inside each change, where the input is checked with zod
// and the request's row is held (one answer wins). Results are shown in place.

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

async function asOffice<T>(
  label: string,
  work: (ctx: OfficeContext) => Promise<T>,
): Promise<T | Common> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "client_requests")) return { status: "not_allowed" };
  try {
    return await work({ firm: session.firm, officeUserId: session.officeUser.id });
  } catch (error) {
    (await requestLog()).error(`${label} failed`, { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export async function acceptClientRequestAction(
  input: AcceptInput,
): Promise<AcceptResult | Common> {
  return asOffice("accept client request", (ctx) => acceptClientRequest(ctx, input));
}

export async function declineClientRequestAction(
  requestId: unknown,
  reason: unknown,
): Promise<AnswerResult | Common> {
  if (typeof requestId !== "string") return { status: "not_found" };
  return asOffice("decline client request", (ctx) =>
    declineClientRequest(ctx, { requestId, reason }),
  );
}

export async function askClientAction(
  requestId: unknown,
  question: unknown,
): Promise<AnswerResult | Common> {
  if (typeof requestId !== "string") return { status: "not_found" };
  return asOffice("ask client", (ctx) => askClient(ctx, { requestId, question }));
}

export async function markPlannerDoneAction(
  requestId: unknown,
): Promise<PlannerDoneResult | Common> {
  if (typeof requestId !== "string") return { status: "not_found" };
  return asOffice("mark planner done", (ctx) => markPlannerDone(ctx, requestId));
}
