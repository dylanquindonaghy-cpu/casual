"use server";

import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/auth/session-cookie";
import { logoutOffice, refreshOfficeSession } from "@/lib/auth/office-login";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// Office session actions. They never redirect(): the browser navigates itself.

export async function officeLogoutAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readSessionToken("office");
  if (token) await logoutOffice({ firm }, token);
  await clearSessionCookie("office");
}

export async function refreshOfficeSessionAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readSessionToken("office");
  if (!token) return;
  const fresh = await refreshOfficeSession({ firm }, token);
  if (fresh) await setSessionCookie("office", fresh.token, fresh.expiresAt);
}
