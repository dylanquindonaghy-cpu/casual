"use server";

import { z } from "zod";
import { readSessionToken, setSessionCookie } from "@/lib/auth/session-cookie";
import { getClientSession } from "@/lib/client/current-client";
import type { SendProblem } from "@/lib/client/form";
import { refreshClientSession } from "@/lib/client/login";
import { createClientRequest, replyToClientQuestion } from "@/lib/client/requests";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// The client's actions (Phase 36.3, 36.4): sending a request, answering the office's question, and
// keeping the session fresh. The firm comes from the host and the contact from their own cookie;
// the contract from the contact's row, inside each change (never from the form: the input is only
// what they asked for, checked with zod there). They never redirect: the page shows the answer.
// Logging out is the route every login uses (src/app/api/logout/route.ts, kind "client").

export type SendResult =
  | { status: "sent"; urgent: boolean }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: SendProblem };

export async function sendClientRequestAction(request: unknown): Promise<SendResult> {
  const session = await getClientSession();
  if (!session) return { status: "logged_out" };
  try {
    const r = await createClientRequest(
      { firm: session.firm, clientContactId: session.contact.id },
      request,
    );
    if (r.status === "sent") return { status: "sent", urgent: r.urgent !== null };
    if (r.status === "invalid") return { status: r.problem };
    if (r.status === "rate_limited") return r;
    return { status: r.status };
  } catch (error) {
    (await requestLog()).error("client request failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

export type ReplyActionResult =
  | {
      status:
        "sent" | "invalid" | "not_asked" | "not_found" | "not_allowed" | "logged_out" | "error";
    }
  | { status: "rate_limited"; retryAfterMinutes: number };

export async function replyToQuestionAction(
  requestId: unknown,
  note: unknown,
): Promise<ReplyActionResult> {
  const session = await getClientSession();
  if (!session) return { status: "logged_out" };
  if (!z.uuid().safeParse(requestId).success) return { status: "not_found" };
  try {
    return await replyToClientQuestion(
      { firm: session.firm, clientContactId: session.contact.id },
      { requestId: requestId as string, note },
    );
  } catch (error) {
    (await requestLog()).error("client reply failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

// The client's session token, renewed once a day while they use the pages (as the office's:
// src/app/office/session-actions.ts).
export async function refreshClientSessionAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readSessionToken("client");
  if (!token) return;
  const fresh = await refreshClientSession({ firm }, token);
  if (fresh) await setSessionCookie("client", fresh.token, fresh.expiresAt);
}
