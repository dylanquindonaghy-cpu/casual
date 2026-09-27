import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { officeUsers } from "../db/schema";
import { recordEvent } from "../events/record";
import { sendFirmJob } from "../jobs/firm-job";
import {
  authParts,
  consumeLoginLink,
  logout,
  refreshSession,
  type AuthContext,
  type RateLimited,
} from "./link-login";
import { canAccess, type OfficeRole } from "./roles";
import { sendPortalLinkJob } from "./send-portal-link";
import { findSession, type ActiveSession } from "./sessions";
import { LIMITS, throttle } from "./throttle";
import { looksLikeToken } from "./tokens";

// Office login (docs/architecture.md, Login): work email -> one-time link by email -> 30-day
// session, with a role (admin, resourcer, payroll). Same rules as worker login: the same answer
// whether or not the address is known, links used once, the firm from the request's host.

export type OfficeRequestResult = { status: "sent" } | { status: "invalid_email" } | RateLimited;

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return z.email().max(254).safeParse(email).success ? email : null;
}

export async function requestOfficeLoginLink(
  ctx: AuthContext,
  rawEmail: string,
): Promise<OfficeRequestResult> {
  const email = normaliseEmail(rawEmail);
  const { now, run, secret, ip } = authParts(ctx);
  // IP first, stopping at the first refusal, as for workers (see throttle()).
  const limited = await throttle(
    run,
    ctx.firm.id,
    [
      { limit: LIMITS.officeLoginPerIp, value: ip },
      ...(email ? [{ limit: LIMITS.officeLoginPerEmail, value: email }] : []),
    ],
    { now, secret, entityType: "login_request" },
  );
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };
  if (!email) return { status: "invalid_email" };
  const requestId = randomUUID();
  await run(ctx.firm.id, async (tx) => {
    const [user] = await tx
      .select({ id: officeUsers.id })
      .from(officeUsers)
      .where(and(eq(officeUsers.email, email), eq(officeUsers.status, "active")));
    await recordEvent(tx, {
      actorType: "system",
      action: "auth.link_requested",
      entityType: "login_request",
      entityId: requestId,
      data: { kind: "office", matched: Boolean(user) },
    });
    await sendFirmJob(tx, sendPortalLinkJob, {
      idempotencyKey: requestId,
      purpose: "office_login",
      subjectId: user?.id ?? null,
    });
  });
  return { status: "sent" };
}

export type OfficeConsumeResult =
  { status: "ok"; token: string; expiresAt: Date; officeUserId: string } | { status: "rejected" };

export async function consumeOfficeLoginLink(
  ctx: AuthContext,
  token: string,
): Promise<OfficeConsumeResult | RateLimited> {
  const r = await consumeLoginLink(ctx, "office", token);
  return r.status === "ok"
    ? { status: "ok", token: r.token, expiresAt: r.expiresAt, officeUserId: r.subjectId }
    : r;
}

export interface OfficeSession {
  session: ActiveSession;
  officeUser: { id: string; name: string; role: OfficeRole };
}

export async function currentOfficeUser(
  ctx: AuthContext,
  token: string,
): Promise<OfficeSession | null> {
  if (!looksLikeToken(token)) return null;
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const session = await findSession(tx, { kind: "office", token, now });
    if (!session) return null;
    const [user] = await tx
      .select({ id: officeUsers.id, name: officeUsers.name, role: officeUsers.role })
      .from(officeUsers)
      .where(eq(officeUsers.id, session.subjectId));
    return user ? { session, officeUser: user } : null;
  });
}

export interface TeamMember {
  name: string;
  email: string;
  role: OfficeRole;
  status: "active" | "disabled";
}

// The office team, for admins only. The role is checked here as well as on the page, so the
// data can't be reached by any other route.
export async function officeTeam(ctx: AuthContext, token: string): Promise<TeamMember[] | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "team")) return null;
  const { run } = authParts(ctx);
  return run(ctx.firm.id, (tx) =>
    tx
      .select({
        name: officeUsers.name,
        email: officeUsers.email,
        role: officeUsers.role,
        status: officeUsers.status,
      })
      .from(officeUsers)
      .orderBy(asc(officeUsers.name)),
  );
}

export const refreshOfficeSession = (ctx: AuthContext, token: string) =>
  refreshSession(ctx, "office", token);

export const logoutOffice = (ctx: AuthContext, token: string) => logout(ctx, "office", token);
