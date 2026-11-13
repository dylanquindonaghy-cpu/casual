"use server";

import { z } from "zod";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { consumeClientLoginLink } from "@/lib/client/login";
import { clientIp, requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

export type ClientLinkState =
  { status: "ok" | "rejected" | "error" } | { status: "rate_limited"; retryAfterMinutes: number };

// "Log me in" from the client login email (a POST, so email scanners that open the link can't use
// it up). The browser then goes to the client's events.
export async function consumeClientLinkAction(token: string): Promise<ClientLinkState> {
  const firm = await getCurrentFirm();
  const parsed = z.string().max(100).safeParse(token);
  if (!parsed.success) return { status: "rejected" };
  try {
    const result = await consumeClientLoginLink({ firm, clientIp: await clientIp() }, parsed.data);
    if (result.status === "rate_limited") return result;
    if (result.status !== "ok") return { status: "rejected" };
    await setSessionCookie("client", result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    (await requestLog()).error("client login with link failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
