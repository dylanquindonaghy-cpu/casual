import { staffDemoOn } from "../demo/staff-login";
import { appEnv } from "../env";
import { getCurrentFirm } from "../tenancy/current-firm";

// Where a redirect to a login goes (Phase 34; docs/screens.md "Phase 34"). Where the staffing demo
// login is on (a demo server, on Acme: staffDemoOn), every way back to a login lands on it, for the
// office and the casual app alike; everywhere else, each side's own login page. Only the
// redirects: /login and /office/login opened by address still show.
export const STAFF_LOGIN_PAGE = "/start/login";

export type LoginKind = "worker" | "office";

const OWN_LOGIN: Record<LoginKind, string> = { worker: "/login", office: "/office/login" };

// Pure, for the tests: the page for this kind, on this firm, in this demo mode.
export function loginPageOf(kind: LoginKind, demoMode: string | undefined, firmId: string | null) {
  return staffDemoOn(demoMode, firmId) ? STAFF_LOGIN_PAGE : OWN_LOGIN[kind];
}

// The same for this request's firm (the host's).
export async function loginPageFor(kind: LoginKind): Promise<string> {
  const firm = await getCurrentFirm();
  return loginPageOf(kind, appEnv().DEMO_MODE, firm.id);
}

// For /login and /office/login: when a redirect sent the browser there (`out=1` after Log out,
// `again=1` from an action that found the session gone) and the staffing demo login is on, the
// address to send it on to (keeping "You're logged out."); null to show the page itself.
export function staffLoginAfterRedirect(
  kind: LoginKind,
  firmId: string | null,
  params: { out?: string; again?: string },
  demoMode: string | undefined = appEnv().DEMO_MODE,
): string | null {
  if (params.out !== "1" && params.again !== "1") return null;
  if (loginPageOf(kind, demoMode, firmId) !== STAFF_LOGIN_PAGE) return null;
  return params.out === "1" ? `${STAFF_LOGIN_PAGE}?out=1` : STAFF_LOGIN_PAGE;
}
