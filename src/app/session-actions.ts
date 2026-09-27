"use server";

import {
  clearWorkerSessionCookie,
  readWorkerSessionToken,
  setWorkerSessionCookie,
} from "@/lib/auth/session-cookie";
import { logoutWorker, refreshWorkerSession } from "@/lib/auth/worker-login";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// Server actions here never redirect(): Next renders an action's redirect target by fetching it
// from the server's own origin, which loses the firm's Host header. The browser navigates itself.

export async function logoutAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readWorkerSessionToken();
  if (token) await logoutWorker({ firm }, token);
  await clearWorkerSessionCookie();
}

// Pages can't set cookies, so a page whose session token is a day old asks for a new one here.
export async function refreshSessionAction(): Promise<void> {
  const firm = await getCurrentFirm();
  const token = await readWorkerSessionToken();
  if (!token) return;
  const fresh = await refreshWorkerSession({ firm }, token);
  if (fresh) await setWorkerSessionCookie(fresh.token, fresh.expiresAt);
}
