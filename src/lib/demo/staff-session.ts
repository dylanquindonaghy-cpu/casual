import { and, eq } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { createSession, findSession } from "../auth/sessions";
import { LIMITS, refundLimit, throttle } from "../auth/throttle";
import { looksLikeToken } from "../auth/tokens";
import { officeUsers, workers } from "../db/schema";
import { recordEvent } from "../events/record";
import {
  DEMO_CASUAL_ID,
  DEMO_CASUAL_VIEW_ACTION,
  STAFF_DEMO_USER,
  STAFF_LOGIN_HASH,
  staffDemoOn,
  staffLoginMatches,
} from "./staff-login";

// The staffing demo's two ways in (Phase 31; demo servers only): the login (31.1), which starts an
// office session for the made-up staffing admin, and "Casual mobile view" (31.2), which, from an
// office session, starts a casual's session for the demo story's Zoe. Both check demo mode and the
// firm here, on the server, whatever the page showed. The pages and actions in src/app/start only
// read and write the cookies.

export interface StaffDemoContext extends AuthContext {
  demoMode: string | undefined;
  // DEMO_STAFF_LOGIN_HASH, when set (the browser tests'); otherwise the committed hash.
  hash?: string;
}

export type StaffLoginResult =
  | { status: "ok"; token: string; expiresAt: Date; officeUserId: string }
  | { status: "wrong" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "off" };

const nameKey = (raw: string) => raw.trim().toLowerCase().slice(0, 254);

export async function loginWithStaffAccount(
  ctx: StaffDemoContext,
  input: { email: string; password: string },
): Promise<StaffLoginResult> {
  if (!staffDemoOn(ctx.demoMode, ctx.firm.id)) return { status: "off" };
  const { now, run, secret, ip } = authParts(ctx);
  const checks = [
    { limit: LIMITS.demoLoginPerIp, value: ip },
    { limit: LIMITS.demoLoginPerName, value: nameKey(input.email) },
  ];
  // Every try is counted first, each limit in one statement, committed before the password is
  // looked at: so tries sent all at once can't all get under a limit before any is counted. Over a
  // limit: refused, the password never checked (the entry once, when it's first reached).
  const limited = await throttle(run, ctx.firm.id, checks, {
    now,
    secret,
    entityType: "login_request",
  });
  if (limited) return { status: "rate_limited", retryAfterMinutes: limited.retryAfterMinutes };

  const matches = await staffLoginMatches(input, ctx.hash ?? STAFF_LOGIN_HASH);
  return run(ctx.firm.id, async (tx) => {
    if (!matches) {
      // Logged as a refused login link is: that it happened, never the name typed or the IP.
      await recordEvent(tx, {
        actorType: "system",
        action: "auth.demo_login_failed",
        entityType: "login_request",
        entityId: null,
        data: {},
      });
      return { status: "wrong" } as const;
    }
    // A right pair takes its count back: only wrong pairs count against the limits.
    for (const check of checks) await refundLimit(tx, { ...check, now, secret });
    const [user] = await tx
      .select({ id: officeUsers.id })
      .from(officeUsers)
      .where(and(eq(officeUsers.id, STAFF_DEMO_USER.id), eq(officeUsers.status, "active")));
    // The seed adds the account; without it (or turned off) the pair opens nothing.
    if (!user) return { status: "wrong" } as const;
    const session = await createSession(tx, { kind: "office", subjectId: user.id, now });
    await recordEvent(tx, {
      actorType: "office",
      actorId: user.id,
      action: "auth.demo_login",
      entityType: "session",
      entityId: session.id,
      data: { kind: "office" },
    });
    return {
      status: "ok",
      token: session.token,
      expiresAt: session.expiresAt,
      officeUserId: user.id,
    } as const;
  });
}

export type CasualViewResult =
  | { status: "ok"; token: string; expiresAt: Date; workerId: string }
  | { status: "logged_out" }
  | { status: "no_casual" }
  | { status: "off" };

// From an office session (any office user's, on the demo firm), a casual's session for Zoe.
export async function openCasualView(
  ctx: StaffDemoContext,
  officeToken: string | undefined,
): Promise<CasualViewResult> {
  if (!staffDemoOn(ctx.demoMode, ctx.firm.id)) return { status: "off" };
  if (!officeToken || !looksLikeToken(officeToken)) return { status: "logged_out" };
  const { now, run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const office = await findSession(tx, { kind: "office", token: officeToken, now });
    if (!office) return { status: "logged_out" } as const;
    const [casual] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.id, DEMO_CASUAL_ID), eq(workers.status, "active")));
    if (!casual) return { status: "no_casual" } as const;
    const session = await createSession(tx, { kind: "worker", subjectId: casual.id, now });
    await recordEvent(tx, {
      actorType: "office",
      actorId: office.subjectId,
      action: DEMO_CASUAL_VIEW_ACTION,
      entityType: "session",
      entityId: session.id,
      data: { kind: "worker", workerId: casual.id },
    });
    return {
      status: "ok",
      token: session.token,
      expiresAt: session.expiresAt,
      workerId: casual.id,
    } as const;
  });
}
