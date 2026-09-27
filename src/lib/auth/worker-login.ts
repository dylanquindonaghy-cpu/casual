import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { sendFirmJob } from "../jobs/firm-job";
import {
  authParts,
  consumeLoginLink,
  loginWithLinkOf,
  logout,
  refreshSession,
  type AuthContext,
  type LinkLoginResult,
  type RateLimited,
} from "./link-login";
import { normaliseMobile } from "./mobile";
import { sendPortalLinkJob } from "./send-portal-link";
import { findSession, type ActiveSession } from "./sessions";
import { LIMITS, throttle } from "./throttle";
import { looksLikeToken } from "./tokens";

// Worker login (docs/architecture.md, Login): mobile number -> one-time link by WhatsApp ->
// 30-day session. These functions are the whole flow; the pages and server actions in src/app
// only read and write the cookie. The firm always comes from the request's host.

export type { AuthContext, RateLimited };

export type RequestLinkResult = { status: "sent" } | { status: "invalid_number" } | RateLimited;

// Same answer, same writes and the same job whether or not the number belongs to an active
// worker here, so neither the reply nor its timing tells anyone whose number it is.
export async function requestWorkerLoginLink(
  ctx: AuthContext,
  rawMobile: string,
): Promise<RequestLinkResult> {
  const mobile = normaliseMobile(rawMobile);
  const { now, run, secret, ip } = authParts(ctx);
  // Every attempt counts against the IP (junk included); valid numbers also against the number,
  // whether or not it belongs to a worker, so hitting a limit reveals nothing either.
  const limited = await throttle(
    run,
    ctx.firm.id,
    [
      { limit: LIMITS.loginPerIp, value: ip },
      ...(mobile ? [{ limit: LIMITS.loginPerNumber, value: mobile }] : []),
    ],
    { now, secret, entityType: "login_request" },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  if (!mobile) return { status: "invalid_number" };
  const requestId = randomUUID();
  await run(ctx.firm.id, async (tx) => {
    const [worker] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.mobileE164, mobile), eq(workers.status, "active")));
    await recordEvent(tx, {
      actorType: "system",
      action: "auth.link_requested",
      entityType: "login_request",
      entityId: requestId,
      data: { kind: "worker", matched: Boolean(worker) },
    });
    await sendFirmJob(tx, sendPortalLinkJob, {
      idempotencyKey: requestId,
      purpose: "worker_login",
      subjectId: worker?.id ?? null,
    });
  });
  return { status: "sent" };
}

export type ConsumeLinkResult =
  { status: "ok"; token: string; expiresAt: Date; workerId: string } | { status: "rejected" };

const toWorkerResult = (r: LinkLoginResult): ConsumeLinkResult =>
  r.status === "ok"
    ? { status: "ok", token: r.token, expiresAt: r.expiresAt, workerId: r.subjectId }
    : r;

export async function consumeWorkerLoginLink(
  ctx: AuthContext,
  token: string,
): Promise<ConsumeLinkResult | RateLimited> {
  const result = await consumeLoginLink(ctx, "worker", token);
  return result.status === "rate_limited" ? result : toWorkerResult(result);
}

// The worker login itself, inside the firm's transaction (see loginWithLinkOf).
export async function loginWithLink(
  tx: FirmTx,
  opts: { token: string; now: Date },
): Promise<ConsumeLinkResult> {
  return toWorkerResult(await loginWithLinkOf(tx, { kind: "worker", ...opts }));
}

export interface WorkerSession {
  session: ActiveSession;
  worker: { id: string; firstName: string };
}

export async function currentWorker(
  ctx: AuthContext,
  token: string,
): Promise<WorkerSession | null> {
  if (!looksLikeToken(token)) return null;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const session = await findSession(tx, { kind: "worker", token, now });
    if (!session) return null;
    const [worker] = await tx
      .select({ id: workers.id, firstName: workers.firstName })
      .from(workers)
      .where(eq(workers.id, session.subjectId));
    return worker ? { session, worker } : null;
  });
}

export const refreshWorkerSession = (ctx: AuthContext, token: string) =>
  refreshSession(ctx, "worker", token);

export const logoutWorker = (ctx: AuthContext, token: string) => logout(ctx, "worker", token);
