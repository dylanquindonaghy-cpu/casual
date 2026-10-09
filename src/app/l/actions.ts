"use server";

import { z } from "zod";
import { setWorkerSessionCookie } from "@/lib/auth/session-cookie";
import { consumeWorkerLoginLink } from "@/lib/auth/worker-login";
import { clientIp, requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

export type ConsumeLinkState =
  { status: "ok" | "rejected" | "error" } | { status: "rate_limited"; retryAfterMinutes: number };

// "Log me in": uses the one-time link (a POST, so link previews and email scanners that only
// open the page can't use it up), starts a 30-day session and sets the cookie. The browser then
// navigates itself (server actions here never redirect(): see eslint.config.mjs).
export async function consumeLoginLinkAction(token: string): Promise<ConsumeLinkState> {
  const firm = await getCurrentFirm(); // outside try: an unknown firm is a 404, not an error
  const parsed = z.string().max(100).safeParse(token);
  if (!parsed.success) return { status: "rejected" };
  try {
    const result = await consumeWorkerLoginLink({ firm, clientIp: await clientIp() }, parsed.data);
    if (result.status === "rate_limited") return result;
    if (result.status !== "ok") return { status: "rejected" };
    await setWorkerSessionCookie(result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    // The transaction rolled back, so the link is still unused: the worker can tap again.
    (await requestLog()).error("login with link failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
