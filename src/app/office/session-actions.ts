"use server";

import { readSessionToken, setSessionCookie } from "@/lib/auth/session-cookie";
import { refreshOfficeSession } from "@/lib/auth/office-login";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// Office session actions. They never redirect(): the browser navigates itself. Logging out is a
// route: src/app/api/logout/route.ts.

export async function refreshOfficeSessionAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readSessionToken("office");
  if (!token) return;
  const fresh = await refreshOfficeSession({ firm }, token);
  if (fresh) await setSessionCookie("office", fresh.token, fresh.expiresAt);
}
