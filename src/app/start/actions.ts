"use server";

import { z } from "zod";
import { readSessionToken, setSessionCookie } from "@/lib/auth/session-cookie";
import { loginWithStaffAccount, openCasualView, openClientView } from "@/lib/demo/staff-session";
import { appEnv } from "@/lib/env";
import { clientIp, requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// The staffing demo's actions (Phase 31; the client view, 36.5). Demo mode and the firm are
// checked again in src/lib/demo/staff-session.ts, on the server, whatever the page showed: off a
// demo server each refuses. They set the cookie the way the magic-link logins do (src/app/office/l/actions.ts,
// src/app/l/actions.ts) and return a result; the browser then goes on by itself.

export type StaffLoginState =
  | { status: "idle" | "ok" | "wrong" | "off" | "error" }
  | { status: "rate_limited"; retryAfterMinutes: number };

const loginForm = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
});

export async function staffLoginAction(
  _prev: StaffLoginState,
  formData: FormData,
): Promise<StaffLoginState> {
  const firm = await getCurrentFirm(); // outside try: an unknown firm is a 404, not an error
  const parsed = loginForm.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { status: "wrong" };
  try {
    const env = appEnv();
    const result = await loginWithStaffAccount(
      {
        firm,
        clientIp: await clientIp(),
        demoMode: env.DEMO_MODE,
        ...(env.DEMO_STAFF_LOGIN_HASH ? { hash: env.DEMO_STAFF_LOGIN_HASH } : {}),
      },
      parsed.data,
    );
    if (result.status !== "ok") return result;
    await setSessionCookie("office", result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    (await requestLog()).error("staffing demo login failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export type CasualViewState = {
  status: "idle" | "ok" | "logged_out" | "no_casual" | "off" | "error";
};

export async function openCasualViewAction(): Promise<CasualViewState> {
  const firm = await getCurrentFirm();
  try {
    const result = await openCasualView(
      { firm, clientIp: await clientIp(), demoMode: appEnv().DEMO_MODE },
      await readSessionToken("office"),
    );
    if (result.status !== "ok") return { status: result.status };
    await setSessionCookie("worker", result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    (await requestLog()).error("casual view failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

export type ClientViewState = {
  status: "idle" | "ok" | "logged_out" | "no_client" | "off" | "error";
};

// "Client view" (Phase 36.5): a client's session for the match day's client login, its own cookie.
export async function openClientViewAction(): Promise<ClientViewState> {
  const firm = await getCurrentFirm();
  try {
    const result = await openClientView(
      { firm, clientIp: await clientIp(), demoMode: appEnv().DEMO_MODE },
      await readSessionToken("office"),
    );
    if (result.status !== "ok") return { status: result.status };
    await setSessionCookie("client", result.token, result.expiresAt);
    return { status: "ok" };
  } catch (error) {
    (await requestLog()).error("client view failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}
