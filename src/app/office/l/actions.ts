"use server";

import { z } from "zod";
import { consumeOfficeLoginLink } from "@/lib/auth/office-login";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { clientIp, requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

export type OfficeLinkState =
  { status: "ok" | "rejected" | "error" } | { status: "rate_limited"; retryAfterMinutes: number };

// "Log me in" from the office login email (a POST, so email scanners that open the link can't
// use it up). The browser then navigates itself.
export async function consumeOfficeLinkAction(token: string): Promise<OfficeLinkState> {
  const firm = await getCurrentFirm();
  const parsed = z.string().max(100).safeParse(token);
  if (!parsed.success) return { status: "rejected" };
  try {
    const result = await consumeOfficeLoginLink({ firm, clientIp: await clientIp() }, parsed.data);
    if (result.status === "rate_limited") return result;
    if (result.status !== "ok") return { status: "rejected" };
    await setSessionCookie("office", result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    (await requestLog()).error("office login with link failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
