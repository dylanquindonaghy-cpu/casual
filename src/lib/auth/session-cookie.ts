import { cookies } from "next/headers";
import type { SubjectKind } from "./sessions";

// Session cookies, one per kind (a worker and an office user can be logged in side by side).
// The __Host- prefix makes browsers refuse a cookie unless it is Secure, has Path=/ and no
// Domain, so another firm's subdomain can't plant or overwrite it (all firm subdomains are the
// same site). httpOnly: page scripts can't read it. Browsers treat http://*.localhost as secure,
// so this works in local development too.
export const SESSION_COOKIES: Record<SubjectKind, string> = {
  worker: "__Host-sd_session",
  office: "__Host-sd_office",
};
export const WORKER_SESSION_COOKIE = SESSION_COOKIES.worker;

export async function readSessionToken(kind: SubjectKind): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIES[kind])?.value;
}

// Only in server actions and route handlers (cookies can't be set while a page renders).
export async function setSessionCookie(
  kind: SubjectKind,
  token: string,
  expiresAt: Date,
): Promise<void> {
  (await cookies()).set(SESSION_COOKIES[kind], token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(kind: SubjectKind): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIES[kind], path: "/", secure: true });
}

export const readWorkerSessionToken = () => readSessionToken("worker");
export const setWorkerSessionCookie = (token: string, expiresAt: Date) =>
  setSessionCookie("worker", token, expiresAt);
export const clearWorkerSessionCookie = () => clearSessionCookie("worker");
